import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { BlogDb } from '../db.js';
import { LlmClient } from '../client.js';
import type { ChatMessage } from '../types.js';
import { NewsFetcher } from './newsFetcher.js';

function safeRm(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'EBUSY') throw e;
  }
}

function fakeClient(captured: ChatMessage[][]): LlmClient {
  const client = new LlmClient({ baseUrl: 'http://127.0.0.1:1', apiKey: 'test', defaultModel: 'test' });
  client.chat = async (messages: ChatMessage[]) => {
    captured.push(messages);
    return '[{"i":0,"score":9,"why":"важно"}]';
  };
  return client;
}

function seedNews(db: BlogDb, blogId: number): void {
  const now = new Date().toISOString();
  for (let i = 0; i < 6; i++) {
    db.insertNews(
      {
        url: `https://example.com/news-${i}`,
        title: `Новость ${i}`,
        summary: `Кратко ${i}`,
        published_at: now,
        source: 'test',
      },
      blogId,
    );
  }
}

test('newsFetcher: per-blog override заменяет критерии, JSON-контракт остаётся', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'news-fetcher-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    const blog = db.getBlogBySlug('nevsky-hram')!;
    seedNews(db, blog.id);
    db.setAgentPrompt(blog.id, 'scout.news', 'Мой отбор: {{topK}} новостей про «{{channel}}», приоритет {{priority}}');

    const captured: ChatMessage[][] = [];
    const result = await new NewsFetcher(fakeClient(captured)).fetch(db, {
      topK: 3,
      blogId: blog.id,
      focus: 'приход',
    });

    assert.equal(result.rawCount, 6);
    assert.equal(result.ranked.length, 1);
    const prompt = captured[0][0].content;
    assert.match(prompt, /Мой отбор: 3 новостей про «Невский храм на Доваторцев», приоритет приход/);
    assert.match(prompt, /ОТВЕТ: строго JSON-массив/);
    assert.match(prompt, /"i" — индекс из списка/);
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('newsFetcher: без override — прежний default-промпт', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'news-fetcher-default-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    const blog = db.getBlogBySlug('nevsky-hram')!;
    seedNews(db, blog.id);
    const captured: ChatMessage[][] = [];
    await new NewsFetcher(fakeClient(captured)).fetch(db, { topK: 2, blogId: blog.id, focus: 'приход' });
    assert.match(captured[0][0].content, /Из списка новостей ниже выбери топ-2 самых важных/);
  } finally {
    db.close();
    safeRm(dir);
  }
});
