// Серверный адаптер твитов: TweetRow → JSON DTO (camelCase) + резолв твита по id/URL.
// Граница web/lib/server — импортирует core только через chokepoint ./challenge.
import 'server-only';
import {
  parseTweetUrl,
  popularityScore,
  discussionScore,
  type BlogDb,
  type TweetRow,
} from './challenge';

export interface TweetDto {
  id: number;
  tweetId: string;
  authorHandle: string;
  text: string;
  url: string;
  publishedAt: string;
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  views: number;
  bookmarks: number;
  media: Array<{ type: string; url: string }>;
  popularity: number;
  discussion: number;
  blogId: number | null;
}

export function toTweetDto(t: TweetRow): TweetDto {
  let media: Array<{ type: string; url: string }> = [];
  try {
    const arr: unknown = JSON.parse(t.media);
    if (Array.isArray(arr)) media = arr as Array<{ type: string; url: string }>;
  } catch {
    // битый JSON media — отдаём пустой список, не валим выдачу
  }
  return {
    id: t.id,
    tweetId: t.tweet_id,
    authorHandle: t.author_handle,
    text: t.text,
    url: t.url,
    publishedAt: t.published_at,
    likes: t.likes,
    retweets: t.retweets,
    replies: t.replies,
    quotes: t.quotes,
    views: t.views,
    bookmarks: t.bookmarks,
    media,
    popularity: popularityScore(t),
    discussion: discussionScore(t),
    blogId: t.blog_id,
  };
}

/** Резолв твита по DB id, URL или snowflake-ID (как CLI resolveTweet). */
export function resolveTweetRow(db: BlogDb, input: string): TweetRow | null {
  const ref = parseTweetUrl(input);
  if (ref) return db.getTweetByTweetId(ref.id);
  if (/^\d+$/.test(input.trim())) return db.getTweet(Number(input.trim()));
  return null;
}