import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { BlogDb } from './db.js';
import { rankByPopularity, authorActivity, windowSinceIso, type Tweet } from './tweets.js';

function safeRm(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'EBUSY') throw e;
  }
}

function tweet(over: Partial<Tweet> = {}): Tweet {
  return {
    tweetId: '2122351771880456203',
    authorHandle: 'markrstats',
    authorName: 'markstats',
    text: 'Chelsea conceded 1.56 non-penalty xG per game; since Caicedo — 1.00.',
    url: 'https://x.com/markrstats/status/2122351771880456203',
    publishedAt: '2026-11-16T15:31:08.000Z',
    likes: 236, retweets: 43, replies: 1, quotes: 23, views: 25084, bookmarks: 32,
    media: [{ type: 'photo', url: 'https://pbs.twimg.com/media/HXQbnb6bIAAThhN.jpg' }],
    ...over,
  };
}

test('tweets: upsert нового/повторный, engagement обновляется', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    assert.equal(db.upsertTweet(tweet()), true);
    assert.equal(db.tweetsCount(), 1);
    const row = db.getTweetByTweetId('2122351771880456203')!;
    assert.equal(row.author_handle, 'markrstats');
    assert.equal(row.likes, 236);
    assert.equal(JSON.parse(row.media)[0].type, 'photo');
    assert.equal(row.blog_id, null);

    // Повторный ингест того же твита: не дубль, метрики обновлены.
    assert.equal(db.upsertTweet(tweet({ likes: 300, views: 40000 })), false);
    assert.equal(db.tweetsCount(), 1);
    assert.equal(db.getTweetByTweetId('2122351771880456203')!.likes, 300);
    assert.equal(db.getTweet(row.id)!.views, 40000);
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('tweets: автор upsert + blog_id штамп', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    db.upsertTweetAuthor({ handle: 'markrstats', name: 'markstats', description: 'football data', followers: 63619 });
    db.upsertTweetAuthor({ handle: 'markrstats', name: 'markstats', description: 'football data', followers: 64000 });
    const authors = db.tweetAuthors();
    assert.equal(authors.length, 1);
    assert.equal(authors[0].followers, 64000);

    const blog = db.getBlogBySlug('lookatfacts')!;
    db.upsertTweet(tweet(), blog.id);
    assert.equal(db.getTweetByTweetId('2122351771880456203')!.blog_id, blog.id);
    assert.equal(db.listTweets({ blogId: blog.id }).length, 1);
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('tweets: окно/автор/лимит + ранжирование по популярности и активности авторов', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    const now = new Date('2026-11-17T00:00:00Z');
    db.upsertTweet(tweet({ tweetId: '1', authorHandle: 'a', publishedAt: '2026-11-16T00:00:00Z', likes: 10, retweets: 0, replies: 0, quotes: 0, views: 0, bookmarks: 0 }));
    db.upsertTweet(tweet({ tweetId: '2', authorHandle: 'b', publishedAt: '2026-11-15T00:00:00Z', likes: 5, retweets: 10, replies: 5, quotes: 5, views: 1000, bookmarks: 0 }));
    db.upsertTweet(tweet({ tweetId: '3', authorHandle: 'a', publishedAt: '2026-10-20T00:00:00Z', likes: 999, retweets: 0, replies: 0, quotes: 0, views: 0, bookmarks: 0 }));

    // Окно 7 дней от now отсекает старый твит '3'.
    const inWindow = db.listTweets({ sinceIso: windowSinceIso(7, now) });
    assert.deepEqual(inWindow.map((t) => t.tweet_id), ['1', '2']);

    const ranked = rankByPopularity(inWindow);
    assert.equal(ranked[0].tweet_id, '2'); // 70 > 10

    const act = authorActivity(inWindow);
    assert.equal(act.length, 2);
    // В окне у a и b по 1 твиту → tie по count решается популярностью (b: 70 > a: 10).
    assert.equal(act[0].handle, 'b');
    assert.equal(act[0].count, 1);

    assert.equal(db.listTweets({ author: 'a' }).length, 2);
    assert.equal(db.listTweets({ limit: 1 }).length, 1);
    // Окно 30 дней включает все три.
    assert.equal(db.listTweets({ sinceIso: windowSinceIso(30, now) }).length, 3);
  } finally {
    db.close();
    safeRm(dir);
  }
});