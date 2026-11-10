import test from 'node:test';
import assert from 'node:assert/strict';

import { LlmClient } from '../client.js';
import type { ChatMessage } from '../types.js';
import { Orchestrator } from './orchestrator.js';
import type { SourceAgentResult } from './sourceAgent.js';

const RESULTS: SourceAgentResult[] = [
  {
    agent: 'rss',
    topics: [
      {
        title: 'Тема один',
        description: 'Описание',
        source: 'rss',
        hypeScore: 50,
        hypeReason: 'обсуждают',
      },
    ],
  },
];

function fakeClient(captured: ChatMessage[][]): LlmClient {
  const client = new LlmClient({ baseUrl: 'http://127.0.0.1:1', apiKey: 'test', defaultModel: 'test' });
  client.chat = async (messages: ChatMessage[]) => {
    captured.push(messages);
    return '[{"idx":"rss-0","score":95,"reason":"важно"}]';
  };
  return client;
}

test('orchestrator: per-blog критерии заменяют default, JSON-контракт остаётся', async () => {
  const captured: ChatMessage[][] = [];
  const orch = new Orchestrator(fakeClient(captured), 'Мои критерии: топ-{{topK}} для храма');
  const result = await orch.decide(RESULTS, 'жизнь прихода', 2);

  assert.equal(result.ranked.length, 1);
  const prompt = captured[0][0].content;
  assert.match(prompt, /Мои критерии: топ-2 для храма/);
  assert.match(prompt, /Ответь СТРОГО JSON-массивом/);
  assert.ok(!prompt.includes('спортивный редактор-оркестратор'));
});

test('orchestrator: без override — прежний default', async () => {
  const captured: ChatMessage[][] = [];
  const orch = new Orchestrator(fakeClient(captured));
  await orch.decide(RESULTS, 'футбол', 3);
  assert.match(captured[0][0].content, /Ты спортивный редактор-оркестратор/);
});
