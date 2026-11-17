// Twitter-источник статистических постов: ингест твитов блогеров + source-агент scout.
//
// Два пути ингеста:
//   1. fetchTweet/ingestTweet — одиночный твит по URL/ID через api.fxtwitter.com (rich JSON,
//      работает без ключей). Основной валидируемый путь.
//   2. fetchAuthorTimeline — таймлайн блогера через syndication.twitter.com (best-effort:
//      хост может быть недоступен/заблокирован; в prod идёт через netFetch proxy-first).
//   3. ingestManualTweet — офлайн-ввод (текст+метрики), когда scraping недоступен.
// Fetcher инжектируется (как ForumFetcher): тесты без сети, prod — netFetch.
// Source-агент TwitterScannerAgent читает УЖЕ сохранённые твиты из БД (без сети) и ранжирует
// по популярности — интеграция tweet-хранилища в scout (runSourceAgents, opt-in enableTwitter).
// Внешний контент — tainted: clean() на границе парсинга (tweets.ts).

import { createHash } from 'node:crypto';

import type { BlogDb, TweetRow } from '../db.js';
import { netFetch, type NetFetchInit } from '../net.js';
import { clean } from '../sanitize.js';
import {
  parseTweetUrl,
  parseFxTweet,
  parseFxAuthor,
  rankByPopularity,
  windowSinceIso,
  type Tweet,
  type TweetAuthor,
  type TweetMedia,
} from '../tweets.js';
import type { SourceAgent, SourceAgentResult, TrendingTopic } from './sourceAgent.js';

const FX_BASE = 'https://api.fxtwitter.com';
const SYNDICATION_BASE = 'https://syndication.twitter.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 football-bot/1.0';

export type TwitterFetcher = (url: string, init?: NetFetchInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
function safeHttpUrl(value: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Одиночный твит по URL/ID через fxtwitter. Бросает при недоступности/битом ответе. */
export async function fetchTweet(input: string, fetcher: TwitterFetcher = netFetch): Promise<Tweet> {
  const ref = parseTweetUrl(input);
  if (!ref) throw new Error('Не ссылка на твит и не ID (ожидается x.com/<author>/status/<id>)');
  const url = `${FX_BASE}/${ref.handle ?? 'i'}/status/${ref.id}`;
  const resp = await fetcher(url, {
    headers: { 'User-Agent': USER_AGENT },
    timeoutMs: 15_000,
    label: 'twitter tweet',
  });
  if (!resp.ok) throw new Error(`twitter tweet HTTP ${resp.status}`);
  const tweet = parseFxTweet(await resp.json());
  if (!tweet) throw new Error('twitter tweet: неожиданный формат ответа');
  return tweet;
}

/** Профиль блогера через fxtwitter (без таймлайна). */
export async function fetchAuthor(handle: string, fetcher: TwitterFetcher = netFetch): Promise<TweetAuthor> {
  const h = clean(handle, 15).replace(/^@/, '');
  const resp = await fetcher(`${FX_BASE}/${encodeURIComponent(h)}`, {
    headers: { 'User-Agent': USER_AGENT },
    timeoutMs: 15_000,
    label: `twitter author @${h}`,
  });
  if (!resp.ok) throw new Error(`twitter author HTTP ${resp.status}`);
  const author = parseFxAuthor(await resp.json());
  if (!author) throw new Error('twitter author: неожиданный формат ответа');
  return author;
}

// --- legacy-твит (syndication timeline): id_str/full_text/user/favorite_count ---
function parseLegacyTweet(obj: Record<string, unknown>): Tweet | null {
  const tweetId = asString(obj.id_str) || asString(obj.id);
  const text = clean(asString(obj.full_text) || asString(obj.text), 4000);
  const user = isRecord(obj.user) ? obj.user : {};
  const authorHandle = clean(asString(user.screen_name), 15);
  const parsed = Date.parse(asString(obj.created_at));
  if (!tweetId || !text || !authorHandle || !Number.isFinite(parsed)) return null;
  const mediaRaw = isRecord(obj.extended_entities) && Array.isArray(obj.extended_entities.media)
    ? obj.extended_entities.media
    : isRecord(obj.entities) && Array.isArray(obj.entities.media)
      ? obj.entities.media
      : [];
  const media: TweetMedia[] = [];
  for (const m of mediaRaw) {
    if (!isRecord(m)) continue;
    const url = safeHttpUrl(asString(m.media_url_https) || asString(m.url));
    if (!url) continue;
    const t = asString(m.type);
    const type = t === 'animated_gif' ? 'gif' : t === 'video' ? 'video' : 'photo';
    media.push({ type, url });
  }
  return {
    tweetId,
    authorHandle,
    authorName: clean(asString(user.name), 120),
    text,
    url: `https://x.com/${authorHandle}/status/${tweetId}`,
    publishedAt: new Date(parsed).toISOString(),
    likes: asNumber(obj.favorite_count),
    retweets: asNumber(obj.retweet_count),
    replies: asNumber(obj.reply_count),
    quotes: asNumber(obj.quote_count),
    views: asNumber(obj.view_count),
    bookmarks: asNumber(obj.bookmark_count),
    media,
  };
}

/** Рекурсивно собрать tweet-подобные объекты из JSON (защита от вариаций структуры). */
function collectTweets(node: unknown, out: Map<string, Tweet>, depth = 0): void {
  if (depth > 12 || out.size > 200) return;
  if (Array.isArray(node)) {
    for (const item of node) collectTweets(item, out, depth + 1);
    return;
  }
  if (!isRecord(node)) return;
  const parsed = parseLegacyTweet(node);
  if (parsed) out.set(parsed.tweetId, parsed);
  for (const value of Object.values(node)) collectTweets(value, out, depth + 1);
}

export function extractTweetsFromJson(data: unknown): Tweet[] {
  const out = new Map<string, Tweet>();
  collectTweets(data, out);
  return Array.from(out.values());
}

/**
 * Таймлайн блогера через syndication (best-effort). Парсит __NEXT_DATA__ HTML,
 * собирает твиты автора. Хост может быть недоступен — вызывающий обрабатывает ошибку.
 */
export async function fetchAuthorTimeline(
  handle: string,
  fetcher: TwitterFetcher = netFetch,
  limit = 20,
): Promise<Tweet[]> {
  const h = clean(handle, 15).replace(/^@/, '');
  const url = `${SYNDICATION_BASE}/srv/timeline-profile/screen-name/${encodeURIComponent(h)}`;
  const resp = await fetcher(url, {
    headers: { 'User-Agent': USER_AGENT },
    timeoutMs: 15_000,
    label: `twitter timeline @${h}`,
  });
  if (!resp.ok) throw new Error(`twitter timeline HTTP ${resp.status}`);
  const html = await resp.text();
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('twitter timeline: нет __NEXT_DATA__ (возможно, хост недоступен)');
  let data: unknown;
  try {
    data = JSON.parse(m[1]);
  } catch {
    throw new Error('twitter timeline: битый JSON');
  }
  const all = extractTweetsFromJson(data);
  return all.filter((t) => t.authorHandle.toLowerCase() === h.toLowerCase()).slice(0, limit);
}

export interface IngestResult {
  readonly tweet: TweetRow;
  readonly isNew: boolean;
}

/** Ингест одиночного твита по URL/ID: fetch → upsert твита + профиль автора (best-effort). */
export async function ingestTweet(
  db: BlogDb,
  input: string,
  opts: { fetcher?: TwitterFetcher; blogId?: number | null } = {},
): Promise<IngestResult> {
  const fetcher = opts.fetcher ?? netFetch;
  const parsed = await fetchTweet(input, fetcher);
  const isNew = db.upsertTweet(parsed, opts.blogId);
  if (parsed.authorHandle) {
    try {
      db.upsertTweetAuthor(await fetchAuthor(parsed.authorHandle, fetcher));
    } catch {
      // Профиль недоступен — минимальный автор из твита, существующего не перетираем.
      if (!db.getTweetAuthor(parsed.authorHandle)) {
        db.upsertTweetAuthor({ handle: parsed.authorHandle, name: parsed.authorName, description: '', followers: 0 });
      }
    }
  }
  return { tweet: db.getTweetByTweetId(parsed.tweetId)!, isNew };
}

export interface ManualTweetInput {
  readonly authorHandle: string;
  readonly text: string;
  readonly authorName?: string;
  readonly url?: string;
  readonly tweetId?: string;
  readonly publishedAt?: string;
  readonly likes?: number;
  readonly retweets?: number;
  readonly replies?: number;
  readonly quotes?: number;
  readonly views?: number;
  readonly bookmarks?: number;
  readonly media?: readonly TweetMedia[];
}

/** Офлайн-ингест: текст+метрики без сети. ID — из url/tweetId или стабильный hash(author:text). */
export function ingestManualTweet(
  db: BlogDb,
  input: ManualTweetInput,
  blogId?: number | null,
): IngestResult {
  const authorHandle = clean(input.authorHandle, 15).replace(/^@/, '');
  const text = clean(input.text, 4000);
  if (!authorHandle || !text) throw new Error('manual tweet: authorHandle и text обязательны');
  const fromUrl = input.url ? parseTweetUrl(input.url) : null;
  const tweetId =
    input.tweetId?.trim() ||
    fromUrl?.id ||
    `manual-${createHash('sha1').update(`${authorHandle}:${text}`).digest('hex').slice(0, 16)}`;
  const parsedDate = input.publishedAt ? Date.parse(input.publishedAt) : Number.NaN;
  const publishedAt = Number.isFinite(parsedDate)
    ? new Date(parsedDate).toISOString()
    : new Date().toISOString();
  const url =
    safeHttpUrl(input.url?.trim() ?? '') ??
    (fromUrl ? `https://x.com/${authorHandle}/status/${tweetId}` : `https://x.com/${authorHandle}`);
  const tweet: Tweet = {
    tweetId,
    authorHandle,
    authorName: clean(input.authorName ?? '', 120),
    text,
    url,
    publishedAt,
    likes: input.likes ?? 0,
    retweets: input.retweets ?? 0,
    replies: input.replies ?? 0,
    quotes: input.quotes ?? 0,
    views: input.views ?? 0,
    bookmarks: input.bookmarks ?? 0,
    media: input.media ?? [],
  };
  const isNew = db.upsertTweet(tweet, blogId);
  if (!db.getTweetAuthor(authorHandle)) {
    db.upsertTweetAuthor({ handle: authorHandle, name: tweet.authorName, description: '', followers: 0 });
  }
  return { tweet: db.getTweetByTweetId(tweetId)!, isNew };
}

export interface TwitterScannerOptions {
  readonly limit?: number;
  readonly windowDays?: number;
  readonly handles?: readonly string[];
}

/** Source-агент scout: читает сохранённые твиты из БД (без сети), ранжирует по популярности. */
export class TwitterScannerAgent implements SourceAgent {
  readonly name = 'twitter';
  private readonly db: BlogDb;
  private readonly limit: number;
  private readonly windowDays: number;
  private readonly handles: readonly string[];

  constructor(db: BlogDb, opts: TwitterScannerOptions = {}) {
    this.db = db;
    this.limit = opts.limit ?? 10;
    this.windowDays = opts.windowDays ?? 7;
    this.handles = opts.handles ?? [];
  }

  async fetch(): Promise<SourceAgentResult> {
    let rows = this.db.listTweets({ sinceIso: windowSinceIso(this.windowDays) });
    if (this.handles.length > 0) {
      const set = new Set(this.handles.map((h) => h.toLowerCase().replace(/^@/, '')));
      rows = rows.filter((r) => set.has(r.author_handle.toLowerCase()));
    }
    const ranked = rankByPopularity(rows).slice(0, this.limit);
    const topics: TrendingTopic[] = ranked.map((r) => {
      const flat = r.text.replace(/\s+/g, ' ');
      return {
        title: flat.slice(0, 120),
        description: flat.slice(0, 200),
        source: `twitter/${r.author_handle}`,
        url: r.url,
        hypeScore: Math.min(100, r.popularity),
        hypeReason: `${r.likes} likes, ${r.retweets} RT, ${r.views} views`,
        rawContent: r.text,
      };
    });
    return { agent: this.name, topics };
  }
}