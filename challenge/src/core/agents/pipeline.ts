// Pipeline: связывает rss → агент 1 → агент 2 → агент 3.
// Запускается из CLI командой `news`.

import { BlogDb } from '../db.js';
import { LlmClient } from '../index.js';
import { fetchAllFeeds, filterRecent, toNewsRow } from './rss.js';
import { NewsFetcher, type NewsFetchResult } from './newsFetcher.js';
import { PostWriter, type WrittenPost } from './postWriter.js';
import { FactChecker, type FactCheckResult } from './factChecker.js';

export interface PipelineResult {
  news: NewsFetchResult;
  post: WrittenPost | null;
  factCheck: FactCheckResult | null;
}

export async function runNewsPipeline(
  db: BlogDb,
  client: LlmClient,
  opts: { maxAgeHours?: number; topK?: number; writeForIndex?: number } = {},
): Promise<PipelineResult> {
  const maxAgeHours = opts.maxAgeHours ?? 24;
  const topK = opts.topK ?? 5;

  // 0. Залить свежие RSS в БД (дубликаты по URL отсекаются UNIQUE-индексом).
  const items = filterRecent(await fetchAllFeeds(), maxAgeHours);
  let added = 0;
  for (const item of items) {
    if (db.insertNews(toNewsRow(item))) added++;
  }
  console.log(`[pipeline] RSS: получено ${items.length}, новых в БД ${added}`);

  // 1. Агент 1 — выбрать топ новостей.
  const fetcher = new NewsFetcher(client);
  const news = await fetcher.fetch(db, { maxAgeHours, topK });
  console.log(`[pipeline] Агент 1: кандидатов ${news.rawCount}, выбрано ${news.ranked.length}`);
  if (news.ranked.length === 0) {
    return { news, post: null, factCheck: null };
  }

  // По умолчанию — пишем пост про самую хайповую новость.
  const idx = Math.min(opts.writeForIndex ?? 0, news.ranked.length - 1);
  const chosen = news.ranked[idx].news;
  console.log(`[pipeline] Готовим пост про: "${chosen.title}"`);

  // 2. Агент 2 — написать пост.
  const writer = new PostWriter(client);
  const post = await writer.write(db, chosen);
  console.log(`[pipeline] Агент 2: пост написан (${post.content.length} символов)`);

  // 3. Агент 3 — фактчекинг.
  const checker = new FactChecker(client);
  const factCheck = await checker.check(post.content, chosen);
  console.log(`[pipeline] Агент 3: verdict=${factCheck.verdict}, issues=${factCheck.issues.length}`);

  // Сохранить пост + вердикт, пометить новость использованной.
  db.insertPost(post.content, chosen.id, JSON.stringify(factCheck));
  db.markUsed(chosen.id);

  return { news, post, factCheck };
}
