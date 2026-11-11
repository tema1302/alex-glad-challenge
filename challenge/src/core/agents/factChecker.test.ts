import test from 'node:test';
import assert from 'node:assert/strict';

import { LlmClient } from '../client.js';
import type { NewsRow } from '../db.js';
import type { ChatMessage } from '../types.js';
import { FactChecker } from './factChecker.js';

const NEWS: NewsRow = {
  id: 1,
  url: 'https://example.com/news',
  title: 'Храм открыл двери',
  summary: 'В воскресенье прошла служба.',
  published_at: '2026-11-08T09:00:00.000Z',
  source: 'test',
  used: 0,
  created_at: '2026-11-08T09:00:00.000Z',
  blog_id: 1,
};

function fakeClient(captured: ChatMessage[][]): LlmClient {
  const client = new LlmClient({ baseUrl: 'http://127.0.0.1:1', apiKey: 'test', defaultModel: 'test' });
  client.chat = async (messages: ChatMessage[]) => {
    captured.push(messages);
    return captured.length === 1
      ? 'Проверил имена, даты и числа — расхождений нет.'
      : '{"verdict":"ok","issues":[],"recommendation":"ок"}';
  };
  return client;
}

test('factChecker: per-blog override попадает в reasoning и verdict, JSON-контракт остаётся', async () => {
  const captured: ChatMessage[][] = [];
  const checker = new FactChecker(fakeClient(captured), {
    channel: 'Невский храм',
    topic: 'приход',
    reasoningPrompt: 'Мой чек-лист для «{{channel}}»',
    verdictPrompt: 'Мой вердикт для «{{channel}}»',
  });
  const result = await checker.check('Готовый пост', NEWS);

  assert.equal(result.verdict, 'ok');
  assert.equal(captured.length, 2);
  const reasoning = captured[0][0].content;
  const verdict = captured[1][0].content;
  assert.match(reasoning, /Мой чек-лист для «Невский храм»/);
  assert.match(reasoning, /=== ИСТОЧНИК \(НОВОСТЬ\) ===/);
  assert.match(verdict, /Мой вердикт для «Невский храм»/);
  assert.match(verdict, /"verdict": "ok" \| "needs_revision"/);
  assert.match(verdict, /severity/);
});

test('factChecker: без override — встроенный чек-лист и канал', async () => {
  const captured: ChatMessage[][] = [];
  const checker = new FactChecker(fakeClient(captured), { channel: 'Тест' });
  await checker.check('Готовый пост', NEWS);
  const reasoning = captured[0][0].content;
  assert.match(reasoning, /Ты строгий редактор-фактчекер Telegram-канала «Тест»/);
  assert.match(reasoning, /Проверь ВСЕ типы фактов последовательно/);
  assert.match(captured[1][0].content, /"verdict"/);
});

test('factChecker: битый JSON остаётся fail-closed', async () => {
  const client = new LlmClient({ baseUrl: 'http://127.0.0.1:1', apiKey: 'test', defaultModel: 'test' });
  let calls = 0;
  client.chat = async () => {
    calls++;
    return calls === 1 ? 'рассуждение' : 'это не json';
  };
  const result = await new FactChecker(client, { channel: 'Тест' }).check('пост', NEWS);
  assert.equal(result.verdict, 'needs_revision');
});
