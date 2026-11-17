import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { BlogDb } from '../db.js';
import { windowSinceIso, type Tweet } from '../tweets.js';
import {
  fetchTweet,
  fetchAuthor,
  fetchAuthorTimeline,
  extractTweetsFromJson,
  ingestTweet,
  ingestManualTweet,
  TwitterScannerAgent,
  type TwitterFetcher,
} from './twitterSource.js';

function safeRm(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'EBUSY') throw e;
  }
}
function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
}

const FX_TWEET = {
  code: 200,
  tweet: {
    url: 'https://x.com/markrstats/status/2122351771880456203',
    id: '2122351771880456203',
    text: 'Chelsea conceded 1.56 non-penalty xG per game; since Caicedo — 1.00, 6th.',
    author: { screen_name: 'markrstats', name: 'markstats' },
    created_timestamp: 1794843068,
    likes: 236, retweets: 43, replies: 1, quotes: 23, views: 25084, bookmarks: 32,
    media: { all: [{ type: 'photo', url: 'https://pbs.twimg.com/media/x.jpg' }] },
  },
};
const FX_AUTHOR = { code: 200, user: { screen_name: 'markrstats', name: 'markstats', description: 'football data', followers: 63619 } };

const fxFetcher: TwitterFetcher = async (url) => {
  if (url.includes('/status/')) return jsonResponse(FX_TWEET);
  return jsonResponse(FX_AUTHOR);
};

test('fetchTweet: URL → твит; не-ссылка и HTTP-ошибка → throw', async () => {
  const t = await fetchTweet('https://x.com/markrstats/status/2122351771880456203?s=19', fxFetcher);
  assert.equal(t.tweetId, '2122351771880456203');
  assert.equal(t.likes, 236);
  await assert.rejects(() => fetchTweet('не ссылка', fxFetcher), /Не ссылка на твит/);
  await assert.rejects(
    () => fetchTweet('2122351771880456203', async () => new Response('no', { status: 404 })),
    /HTTP 404/,
  );
});

test('fetchAuthor: профиль блогера', async () => {
  const a = await fetchAuthor('@markrstats', fxFetcher);
  assert.equal(a.handle, 'markrstats');
  assert.equal(a.followers, 63619);
});

test('ingestTweet: твит+автор в БД, повторный ингест не дубль', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'twsrc-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    const r1 = await ingestTweet(db, 'https://x.com/markrstats/status/2122351771880456203', { fetcher: fxFetcher });
    assert.equal(r1.isNew, true);
    assert.equal(r1.tweet.author_handle, 'markrstats');
    assert.equal(db.getTweetAuthor('markrstats')!.followers, 63619);
    const r2 = await ingestTweet(db, '2122351771880456203', { fetcher: fxFetcher });
    assert.equal(r2.isNew, false);
    assert.equal(db.tweetsCount(), 1);
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('ingestTweet: профиль недоступен → минимальный автор из твита', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'twsrc-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    const fetcher: TwitterFetcher = async (url) => {
      if (url.includes('/status/')) return jsonResponse(FX_TWEET);
      throw new Error('profile down');
    };
    const r = await ingestTweet(db, 'https://x.com/markrstats/status/2122351771880456203', { fetcher });
    assert.equal(r.tweet.author_handle, 'markrstats');
    assert.equal(db.getTweetAuthor('markrstats')!.name, 'markstats');
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('ingestManualTweet: офлайн-ввод, стабильный dedup по author:text', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'twsrc-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    const input = { authorHandle: '@markrstats', text: 'Chelsea xG 1.56 → 1.00', likes: 100, views: 5000 };
    const r1 = ingestManualTweet(db, input);
    assert.equal(r1.isNew, true);
    assert.equal(r1.tweet.author_handle, 'markrstats');
    assert.equal(r1.tweet.likes, 100);
    const r2 = ingestManualTweet(db, input);
    assert.equal(r2.isNew, false);
    assert.equal(db.tweetsCount(), 1);
    assert.throws(() => ingestManualTweet(db, { authorHandle: '', text: 'x' }), /обязательны/);
  } finally {
    db.close();
    safeRm(dir);
  }
});

const SYND_HTML = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
  props: { pageProps: { timeline: { entries: [
    { type: 'tweet', content: { tweet: {
      id_str: '111', full_text: 'Chelsea xG 1.56 to 1.00 since Caicedo', created_at: 'Mon Nov 16 15:31:08 +0000 2026',
      user: { screen_name: 'markrstats', name: 'markstats' }, favorite_count: 236, retweet_count: 43, reply_count: 1, quote_count: 23,
      entities: { media: [{ type: 'photo', media_url_https: 'https://pbs.twimg.com/media/x.jpg' }] },
    } } },
    { type: 'tweet', content: { tweet: {
      id_str: '222', full_text: 'other author tweet', created_at: 'Mon Nov 16 10:00:00 +0000 2026',
      user: { screen_name: 'someoneelse', name: 'Some' }, favorite_count: 5, retweet_count: 0,
    } } },
  ] } } },
})}</script></body></html>`;

test('fetchAuthorTimeline: парсит __NEXT_DATA__, только твиты автора', async () => {
  const fetcher: TwitterFetcher = async () => new Response(SYND_HTML, { status: 200 });
  const tweets = await fetchAuthorTimeline('markrstats', fetcher);
  assert.equal(tweets.length, 1);
  assert.equal(tweets[0].tweetId, '111');
  assert.equal(tweets[0].likes, 236);
  assert.equal(tweets[0].media[0].type, 'photo');
});

test('extractTweetsFromJson: дедуп по id, защита от мусора', () => {
  const data = { a: { id_str: '1', full_text: 't', created_at: 'Mon Nov 16 15:31:08 +0000 2026', user: { screen_name: 'h' } },
    b: { id_str: '1', full_text: 't', created_at: 'Mon Nov 16 15:31:08 +0000 2026', user: { screen_name: 'h' } },
    c: { not: 'a tweet' } };
  assert.equal(extractTweetsFromJson(data).length, 1);
  assert.equal(extractTweetsFromJson(null).length, 0);
});

test('TwitterScannerAgent: ранжирует сохранённые твиты, фильтр авторов и окно', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'twsrc-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    const base: Tweet = {
      tweetId: '1', authorHandle: 'markrstats', authorName: 'markstats', text: 'xG Chelsea', url: 'https://x.com/markrstats/status/1',
      publishedAt: new Date().toISOString(), likes: 10, retweets: 0, replies: 0, quotes: 0, views: 0, bookmarks: 0, media: [],
    };
    db.upsertTweet(base);
    db.upsertTweet({ ...base, tweetId: '2', authorHandle: 'other', text: 'big stats', likes: 500, retweets: 100, views: 90000 });
    db.upsertTweet({ ...base, tweetId: '3', publishedAt: windowSinceIso(40), likes: 9999 }); // вне окна 7д

    const all = await new TwitterScannerAgent(db, { windowDays: 7 }).fetch();
    assert.equal(all.agent, 'twitter');
    assert.equal(all.topics.length, 2); // '3' вне окна
    assert.equal(all.topics[0].source, 'twitter/other'); // популярность выше
    assert.ok(all.topics[0].hypeScore > all.topics[1].hypeScore);

    const filtered = await new TwitterScannerAgent(db, { handles: ['markrstats'] }).fetch();
    assert.equal(filtered.topics.length, 1);
    assert.equal(filtered.topics[0].source, 'twitter/markrstats');
  } finally {
    db.close();
    safeRm(dir);
  }
});