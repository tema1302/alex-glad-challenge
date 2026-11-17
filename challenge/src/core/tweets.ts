// Твиты блогеров как источник статистических постов: чистые типы/парсинг/ранжирование.
// Без I/O и без БД — только преобразования и арифметика (тестируется без сети/sqlite).
// Внешний контент (текст твита, имена) — tainted: sanitize через clean() на границе парсинга.
// Популярность/активность — взвешенный engagement; окна 1/3/7/30/custom дней.

import { clean } from './sanitize.js';

/** Медиа твита (график/фото/видео). URL валидируется как http(s). */
export interface TweetMedia {
  readonly type: 'photo' | 'video' | 'gif';
  readonly url: string;
}

/** Счётчики вовлечённости — общая форма для parsed-твита и DB-строки. */
export interface TweetEngagement {
  readonly likes: number;
  readonly retweets: number;
  readonly replies: number;
  readonly quotes: number;
  readonly views: number;
  readonly bookmarks: number;
}

/** Разобранный твит (camelCase, до записи в БД). */
export interface Tweet extends TweetEngagement {
  readonly tweetId: string;
  readonly authorHandle: string;
  readonly authorName: string;
  readonly text: string;
  readonly url: string;
  readonly publishedAt: string; // ISO
  readonly media: readonly TweetMedia[];
}

/** Блогер-автор твитов. */
export interface TweetAuthor {
  readonly handle: string;
  readonly name: string;
  readonly description: string;
  readonly followers: number;
}

/** Пресеты окон ранжирования (дни); custom — любое положительное число дней. */
export const TWEET_WINDOW_PRESETS: readonly number[] = [1, 3, 7, 30];

const MS_PER_DAY = 86_400_000;

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

/**
 * Разобрать ссылку на твит или голый ID.
 * Принимает x.com/twitter.com/<handle>/status/<id> (с query/хвостом) и числовой ID.
 * handle может отсутствовать (голый ID) — fxtwitter отдаёт твит и по /status/<id>.
 */
export function parseTweetUrl(input: string): { handle: string | null; id: string } | null {
  const s = input.trim();
  if (!s) return null;
  if (/^\d{5,25}$/.test(s)) return { handle: null, id: s };
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'x.com' && host !== 'twitter.com' && host !== 'mobile.twitter.com') return null;
  const m = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})/);
  if (m) return { handle: m[1], id: m[2] };
  const bare = url.pathname.match(/^\/status(?:es)?\/(\d{5,25})/);
  if (bare) return { handle: null, id: bare[1] };
  return null;
}

function parseMedia(raw: unknown): TweetMedia[] {
  if (!isRecord(raw)) return [];
  const list = Array.isArray(raw.all) ? raw.all : Array.isArray(raw.photos) ? raw.photos : [];
  const out: TweetMedia[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const type = asString(item.type);
    const url = safeHttpUrl(asString(item.url));
    if (!url) continue;
    if (type === 'photo' || type === 'video' || type === 'gif') out.push({ type, url });
  }
  return out;
}

function toIso(timestampSec: unknown, createdAt: unknown): string | null {
  const ts = asNumber(timestampSec);
  if (ts > 0) return new Date(ts * 1000).toISOString();
  const parsed = Date.parse(asString(createdAt));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/**
 * Разобрать ответ api.fxtwitter.com/<handle>/status/<id> → Tweet.
 * Защитное сужение unknown: нет id/текста/даты → null (не выдумываем данные).
 */
export function parseFxTweet(data: unknown): Tweet | null {
  if (!isRecord(data) || !isRecord(data.tweet)) return null;
  const t = data.tweet;
  const tweetId = asString(t.id);
  const text = clean(asString(t.text), 4000);
  if (!tweetId || !text) return null;
  const author = isRecord(t.author) ? t.author : {};
  const authorHandle = clean(asString(author.screen_name), 15);
  const publishedAt = toIso(t.created_timestamp, t.created_at);
  if (!publishedAt) return null;
  const url =
    safeHttpUrl(asString(t.url)) ??
    (authorHandle ? `https://x.com/${authorHandle}/status/${tweetId}` : `https://x.com/i/status/${tweetId}`);
  return {
    tweetId,
    authorHandle,
    authorName: clean(asString(author.name), 120),
    text,
    url,
    publishedAt,
    likes: asNumber(t.likes),
    retweets: asNumber(t.retweets),
    replies: asNumber(t.replies),
    quotes: asNumber(t.quotes),
    views: asNumber(t.views),
    bookmarks: asNumber(t.bookmarks),
    media: parseMedia(t.media),
  };
}

/** Разобрать ответ api.fxtwitter.com/<handle> → TweetAuthor (профиль, без таймлайна). */
export function parseFxAuthor(data: unknown): TweetAuthor | null {
  if (!isRecord(data) || !isRecord(data.user)) return null;
  const u = data.user;
  const handle = clean(asString(u.screen_name), 15);
  if (!handle) return null;
  return {
    handle,
    name: clean(asString(u.name), 120),
    description: clean(asString(u.description), 500),
    followers: asNumber(u.followers),
  };
}

/** Взвешенная популярность (охват): лайки + репосты/цитаты + просмотры/100 + закладки. */
export function popularityScore(e: TweetEngagement): number {
  return (
    e.likes +
    3 * e.retweets +
    3 * e.quotes +
    2 * e.replies +
    2 * e.bookmarks +
    Math.floor(e.views / 100)
  );
}

/** Активность обсуждения: ответы + цитаты (дискуссия, а не охват). */
export function discussionScore(e: TweetEngagement): number {
  return 2 * e.replies + 3 * e.quotes;
}

/** ISO-граница окна «N дней назад» от now. days — положительное конечное число (custom допустим). */
export function windowSinceIso(days: number, now: Date = new Date()): string {
  if (!Number.isFinite(days) || days <= 0) {
    throw new RangeError('days: положительное конечное число');
  }
  return new Date(now.getTime() - days * MS_PER_DAY).toISOString();
}

/** Ранжирование по популярности (убыв.). Не мутирует вход; ties сохраняют порядок. */
export function rankByPopularity<T extends TweetEngagement>(
  rows: readonly T[],
): Array<T & { popularity: number }> {
  return rows
    .map((row) => ({ ...row, popularity: popularityScore(row) }))
    .sort((a, b) => b.popularity - a.popularity);
}

/** Ранжирование по активности обсуждения (убыв.). */
export function rankByDiscussion<T extends TweetEngagement>(
  rows: readonly T[],
): Array<T & { discussion: number }> {
  return rows
    .map((row) => ({ ...row, discussion: discussionScore(row) }))
    .sort((a, b) => b.discussion - a.discussion);
}

export interface AuthorActivity {
  readonly handle: string;
  readonly count: number;
  readonly popularity: number;
}

/** Активность авторов в окне: кол-во твитов (убыв.), при равенстве — суммарная популярность. */
export function authorActivity<T extends TweetEngagement & { author_handle: string }>(
  rows: readonly T[],
): AuthorActivity[] {
  const map = new Map<string, { count: number; popularity: number }>();
  for (const row of rows) {
    const cur = map.get(row.author_handle) ?? { count: 0, popularity: 0 };
    cur.count += 1;
    cur.popularity += popularityScore(row);
    map.set(row.author_handle, cur);
  }
  return Array.from(map.entries())
    .map(([handle, v]) => ({ handle, count: v.count, popularity: v.popularity }))
    .sort((a, b) => b.count - a.count || b.popularity - a.popularity);
}