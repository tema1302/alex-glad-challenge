import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { BlogDb, DEFAULT_BLOG_SLUG, type TweetRow } from '../db.js';
import { LlmClient } from '../client.js';
import type { ChatMessage } from '../types.js';
import { ingestManualTweet } from './twitterSource.js';
import { writePostFromTweet, tweetToNews } from './statsPost.js';

function safeRm(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'EBUSY') throw e;
  }
}

// Fake LLM без сети: очередь ответов (writer → reasoning → verdict).
function fakeClient(responses: string[], captured: ChatMessage[][]): LlmClient {
  const client = new LlmClient({ baseUrl: 'http://127.0.0.1:1', apiKey: 'test', defaultModel: 'test' });
  let i = 0;
  client.chat = async (messages: ChatMessage[]) => {
    captured.push(messages);
    return responses[Math.min(i++, responses.length - 1)];
  };
  return client;
}

const TWEET_ROW: TweetRow = {
  id: 1, tweet_id: '2122351771880456203', author_handle: 'markrstats',
  text: 'Chelsea conceded 1.56 non-penalty xG per game; since Caicedo — 1.00, 6th.',
  url: 'https://x.com/markrstats/status/2122351771880456203',
  published_at: '2026-11-16T15:31:08.000Z',
  likes: 236, retweets: 43, replies: 1, quotes: 23, views: 25084, bookmarks: 32,
  media: '[{"type":"photo","url":"https://pbs.twimg.com/media/x.jpg"}]',
  fetched_at: '2026-11-17T00:00:00.000Z', blog_id: null,
};

test('tweetToNews: текст+график+описание в summary, источник twitter/<handle>', () => {
  const news = tweetToNews(TWEET_ROW, 5, 'График: xG до/после Кайседо');
  assert.equal(news.source, 'twitter/markrstats');
  assert.equal(news.blog_id, 5);
  assert.ok(news.summary.includes('Caicedo'));
  assert.ok(news.summary.includes('приложен график'));
  assert.ok(news.summary.includes('Описание графика: График: xG'));
  assert.ok(news.title.startsWith('@markrstats:'));
});

test('writePostFromTweet: antonov-пресет, пост в posts (topic=URL, news_id=null)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sp-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    const blog = db.getBlogBySlug(DEFAULT_BLOG_SLUG)!;
    const { tweet } = ingestManualTweet(db, { authorHandle: 'markrstats', text: TWEET_ROW.text, url: TWEET_ROW.url, likes: 236 }, blog.id);
    const captured: ChatMessage[][] = [];
    const client = fakeClient(['Иди на факты глянь: Кайседо включился — и Челси поехал. Переведу на человеческий: 1.56 → 1.00 xG. Нет.'], captured);

    const res = await writePostFromTweet(db, client, tweet, { blog, factCheck: false });
    assert.equal(captured.length, 1); // только writer, без фактчека
    assert.match(captured[0][0].content, /Перепиши текст пользователя/); // antonov preset
    assert.equal(res.factCheck, null);
    const stored = db.getPost(res.postId)!;
    assert.equal(stored.news_id, null);
    assert.equal(stored.topic, tweet.url);
    assert.equal(stored.blog_id, blog.id);
    assert.ok(stored.content.startsWith('Иди на факты глянь'));
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('writePostFromTweet: фактчек включён → verdict ok сохранён', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sp-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    const blog = db.getBlogBySlug(DEFAULT_BLOG_SLUG)!;
    const { tweet } = ingestManualTweet(db, { authorHandle: 'markrstats', text: TWEET_ROW.text, url: TWEET_ROW.url }, blog.id);
    const captured: ChatMessage[][] = [];
    const client = fakeClient([
      'Иди на факты глянь: пост про xG.',
      'Проверил числа: 1.56 и 1.00 совпадают с источником.',
      '{"verdict":"ok","issues":[],"recommendation":"Публикуем."}',
    ], captured);
    const res = await writePostFromTweet(db, client, tweet, { blog });
    assert.equal(captured.length, 3); // writer + reasoning + verdict
    assert.equal(res.factCheck?.verdict, 'ok');
    assert.ok(db.getPost(res.postId)!.verdict?.includes('"verdict":"ok"'));
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('writePostFromTweet: архивный блог → throw', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sp-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    const blog = db.getBlogBySlug(DEFAULT_BLOG_SLUG)!;
    db.setBlogArchived(blog.id, true);
    const archived = db.getBlog(blog.id)!;
    const { tweet } = ingestManualTweet(db, { authorHandle: 'markrstats', text: 'x', url: TWEET_ROW.url });
    const client = fakeClient(['пост'], []);
    await assert.rejects(() => writePostFromTweet(db, client, tweet, { blog: archived }), /в архиве/);
  } finally {
    db.close();
    safeRm(dir);
  }
});