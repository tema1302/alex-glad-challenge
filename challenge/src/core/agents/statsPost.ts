// Генерация поста «Иди на факты глянь» из статистического твита блогера.
// Переиспользует PostWriter (пресет antonov через blog lookatfacts) + FactChecker:
// твит маппится в NewsRow-форму (summary = текст твита + описание графика), пост
// пишется голосом блога и сохраняется в posts (news_id=null, topic=URL твита —
// трассировка к источнику; медиа твита остаётся в tweets.media для публикации).
// Доменная логика — в core; Route Handler/CLI лишь вызывают этот сервис.

import type { BlogDb, BlogRow, NewsRow, TweetRow } from '../db.js';
import type { LlmClient } from '../client.js';
import type { ProfileManager } from '../profile.js';
import { resolveBlogAgentPrompt } from '../blogAgentPrompts.js';
import { clean } from '../sanitize.js';
import { PostWriter, type WrittenPost } from './postWriter.js';
import { FactChecker, type FactCheckResult } from './factChecker.js';

export interface TweetPostResult {
  readonly post: WrittenPost;
  readonly factCheck: FactCheckResult | null;
  readonly postId: number;
}

export interface WritePostFromTweetOptions {
  readonly blog?: BlogRow | null;
  readonly profile?: ProfileManager;
  /** Описание графика от автора (данные, которых нет в тексте твита) — вплавляется в источник. */
  readonly chartDescription?: string;
  /** Фактчекинг (2 LLM-вызова). Default true — как в news-pipeline. */
  readonly factCheck?: boolean;
  readonly signal?: AbortSignal;
}

function mediaCount(json: string): number {
  try {
    const arr: unknown = JSON.parse(json);
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}

/** Твит → NewsRow-форма для PostWriter/FactChecker (id=0: не новость из БД). */
export function tweetToNews(tweet: TweetRow, blogId: number | null, chartDescription?: string): NewsRow {
  const flat = tweet.text.replace(/\s+/g, ' ').trim();
  const parts = [tweet.text];
  if (mediaCount(tweet.media) > 0) parts.push('(К твиту приложен график с этой статистикой.)');
  const desc = chartDescription ? clean(chartDescription, 2000) : '';
  if (desc) parts.push(`Описание графика: ${desc}`);
  return {
    id: 0,
    url: tweet.url,
    title: `@${tweet.author_handle}: ${flat.slice(0, 80)}`,
    summary: parts.join('\n'),
    published_at: tweet.published_at,
    source: `twitter/${tweet.author_handle}`,
    used: 0,
    created_at: tweet.fetched_at,
    blog_id: blogId,
  };
}

export async function writePostFromTweet(
  db: BlogDb,
  client: LlmClient,
  tweet: TweetRow,
  opts: WritePostFromTweetOptions = {},
): Promise<TweetPostResult> {
  const blog = opts.blog ?? null;
  if (blog?.archived_at) {
    throw new Error(`Блог «${blog.name}» в архиве — генерация остановлена`);
  }
  opts.signal?.throwIfAborted();
  const news = tweetToNews(tweet, blog?.id ?? null, opts.chartDescription);

  const writer = new PostWriter(client, opts.profile);
  const post = await writer.write(db, news, { blogId: blog?.id });

  let factCheck: FactCheckResult | null = null;
  if (opts.factCheck !== false) {
    opts.signal?.throwIfAborted();
    const checker = new FactChecker(client, {
      channel: opts.profile?.active?.канал,
      topic: opts.profile?.active?.тематика,
      reasoningPrompt: blog ? resolveBlogAgentPrompt(db, blog, 'factcheck.reasoning').prompt : null,
      verdictPrompt: blog ? resolveBlogAgentPrompt(db, blog, 'factcheck.verdict').prompt : null,
    });
    factCheck = await checker.check(post.content, news);
  }

  const postId = db.insertPost(
    post.content,
    null,
    factCheck ? JSON.stringify(factCheck) : null,
    blog?.id,
    tweet.url,
  );
  return { post, factCheck, postId };
}