// Pipeline: связывает rss → агент 1 → агент 2 → агент 3.
// Запускается из CLI командой `news`.
// Профиль пользователя (день 12) прокидывается в PostWriter; мульти-блог:
// opts.blog задаёт источники RSS (blogs.sources) и штамп blog_id на новостях,
// постах и few-shot образцах. Без opts.blog — легаси-режим (дефолтные фиды,
// без штампа) для REPL/CLI-демо.

import { BlogDb, type BlogRow, type NewsRow } from '../db.js';
import type { LlmClient } from '../client.js';
import type { ProfileManager } from '../profile.js';
import { resolveBlogAgentPrompt } from '../blogAgentPrompts.js';
import { fetchAllFeedsDetailed, filterRecent, toNewsRow, feedsFromUrls } from './rss.js';
import { NewsFetcher, type NewsFetchResult } from './newsFetcher.js';
import { PostWriter, type WrittenPost } from './postWriter.js';
import { FactChecker, type FactCheckResult } from './factChecker.js';

export interface PipelineResult {
  news: NewsFetchResult;
  post: WrittenPost | null;
  factCheck: FactCheckResult | null;
  /** Ошибки RSS-фидов (для честного UI: «новостей нет, потому что фиды недоступны»). */
  rssErrors: string[];
}

// blogs.sources — JSON-массив URL; null/битый JSON = дефолтные фиды rss.ts.
function blogFeeds(blog: BlogRow): Array<{ source: string; url: string }> | null {
  if (!blog.sources) return null;
  try {
    const parsed = JSON.parse(blog.sources) as unknown;
    if (!Array.isArray(parsed)) return null;
    const urls = parsed.map(String).filter((u) => /^https?:\/\//.test(u));
    return urls.length > 0 ? feedsFromUrls(urls) : null;
  } catch {
    return null;
  }
}

export async function runNewsPipeline(
  db: BlogDb,
  client: LlmClient,
  opts: {
    maxAgeHours?: number;
    topK?: number;
    writeForIndex?: number;
    profile?: ProfileManager;
    blog?: BlogRow;
    /** Приоритет ранжирования NewsFetcher. Задаётся владельцем (полный
     *  конвейер: тема из scout) — перекрывает тематику профиля. Tainted-текст
     *  санитизируется на границе вызова (web route: clean), тут — как есть. */
    focus?: string;
    signal?: AbortSignal;
    /** Прогресс в sink вызова (CLI/REPL = console.log). Default — тишина:
     * пайплайн гоняется и из web/automationRun, шуметь в их stdout нельзя (§8.2). */
    log?: (line: string) => void;
  } = {},
): Promise<PipelineResult> {
  const maxAgeHours = opts.maxAgeHours ?? 24;
  const topK = opts.topK ?? 5;
  const blog = opts.blog ?? null;
  if (blog?.archived_at) {
    throw new Error(`Блог «${blog.name}» в архиве — генерация остановлена`);
  }
  const profileActive = opts.profile?.active ?? null;
  const log = opts.log ?? (() => {});

  // 0. Залить свежие RSS в БД (дубликаты по URL отсекаются UNIQUE-индексом).
  const { items: fresh, errors: rssErrors } = await fetchAllFeedsDetailed(
    blog ? (blogFeeds(blog) ?? undefined) : undefined,
  );
  if (rssErrors.length > 0) {
    console.warn(`[pipeline] RSS: ошибки фидов — ${rssErrors.join('; ')}`);
  }
  const items = filterRecent(fresh, maxAgeHours);
  let added = 0;
  for (const item of items) {
    if (db.insertNews(toNewsRow(item), blog?.id)) added++;
  }
  log(
    `[pipeline] RSS${blog ? ` [${blog.slug}]` : ''}: получено ${items.length}, новых в БД ${added}`,
  );

  // Профиль для диагностики.
  if (opts.profile?.activeName) {
    log(`[pipeline] Профиль: ${opts.profile.activeName} (${profileActive?.тематика ?? '—'})`);
  }

  // 1. Агент 1 — выбрать топ новостей (только этого блога, приоритет = тематика).
  opts.signal?.throwIfAborted();
  const fetcher = new NewsFetcher(client);
  const news = await fetcher.fetch(db, {
    maxAgeHours,
    topK,
    blogId: blog?.id,
    focus: opts.focus ?? profileActive?.тематика,
  });
  log(`[pipeline] Агент 1: кандидатов ${news.rawCount}, выбрано ${news.ranked.length}`);
  if (news.ranked.length === 0) {
    return { news, post: null, factCheck: null, rssErrors };
  }

  // По умолчанию — пишем пост про самую хайповую новость.
  const idx = Math.min(opts.writeForIndex ?? 0, news.ranked.length - 1);
  const chosen = news.ranked[idx].news;
  log(`[pipeline] Готовим пост про: "${chosen.title}"`);

  const written = await writePostForNews(db, client, chosen, {
    profile: opts.profile,
    blog,
    signal: opts.signal,
  });
  log(`[pipeline] Агент 2: пост написан (${written.post.content.length} символов)`);
  log(`[pipeline] Агент 3: verdict=${written.factCheck.verdict}, issues=${written.factCheck.issues.length}`);

  return { news, post: written.post, factCheck: written.factCheck, rssErrors };
}

export interface PostFromNewsResult {
  post: WrittenPost;
  factCheck: FactCheckResult;
  postId: number;
}

/**
 * Написать пост по уже выбранной новости (без повторного RSS/ранжирования).
 * Используется веб/Android-кнопкой «создать пост» в списке топ-новостей.
 */
export async function runPostFromNews(
  db: BlogDb,
  client: LlmClient,
  opts: {
    newsId: number;
    profile?: ProfileManager;
    blog?: BlogRow;
    signal?: AbortSignal;
  },
): Promise<PostFromNewsResult> {
  const blog = opts.blog ?? null;
  if (blog?.archived_at) {
    throw new Error(`Блог «${blog.name}» в архиве — генерация остановлена`);
  }
  const news = db.getNews(opts.newsId);
  if (!news) throw new Error('Новость не найдена');
  if (blog && news.blog_id !== null && news.blog_id !== blog.id) {
    throw new Error('Новость принадлежит другому блогу');
  }
  opts.signal?.throwIfAborted();
  return writePostForNews(db, client, news, {
    profile: opts.profile,
    blog,
    signal: opts.signal,
  });
}

/** Агенты 2–3 + запись поста: общий путь для полного pipeline и точечной новости. */
async function writePostForNews(
  db: BlogDb,
  client: LlmClient,
  chosen: NewsRow,
  opts: {
    profile?: ProfileManager;
    blog: BlogRow | null;
    signal?: AbortSignal;
  },
): Promise<PostFromNewsResult> {
  const profileActive = opts.profile?.active ?? null;
  opts.signal?.throwIfAborted();
  const writer = new PostWriter(client, opts.profile);
  const post = await writer.write(db, chosen, { blogId: opts.blog?.id });

  opts.signal?.throwIfAborted();
  const checker = new FactChecker(client, {
    channel: profileActive?.канал,
    topic: profileActive?.тематика,
    reasoningPrompt: opts.blog
      ? resolveBlogAgentPrompt(db, opts.blog, 'factcheck.reasoning').prompt
      : null,
    verdictPrompt: opts.blog
      ? resolveBlogAgentPrompt(db, opts.blog, 'factcheck.verdict').prompt
      : null,
  });
  const factCheck = await checker.check(post.content, chosen);

  const postId = db.insertPost(post.content, chosen.id, JSON.stringify(factCheck), opts.blog?.id);
  db.markUsed(chosen.id);
  return { post, factCheck, postId };
}
