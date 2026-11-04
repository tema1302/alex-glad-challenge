import test from 'node:test';
import assert from 'node:assert/strict';

import { callUpstream, UpstreamError, type FetchFn } from './upstream.js';
import type { GatewayUpstreamConfig } from '../env.js';
import { msg } from '../types.js';

function okJson(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const openai: GatewayUpstreamConfig = {
  provider: 'openai',
  baseUrl: 'https://api.example/v1',
  apiKey: 'test-key',
  model: 'test-model',
};

const anthropic: GatewayUpstreamConfig = {
  provider: 'anthropic',
  baseUrl: 'https://anthropic.example/',
  apiKey: 'anthropic-key',
  model: 'claude-test',
};

test('callUpstream OpenAI: URL, Authorization, usage', async () => {
  let seenUrl = '';
  let seenInit: RequestInit | undefined;
  const fetchFn: FetchFn = (url, init) => {
    seenUrl = url;
    seenInit = init;
    return Promise.resolve(
      okJson({
        model: 'test-model',
        choices: [{ message: { content: 'Привет' } }],
        usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
      }),
    );
  };
  const result = await callUpstream(openai, { messages: [msg.user('hi')] }, fetchFn);
  assert.equal(seenUrl, 'https://api.example/v1/chat/completions');
  assert.equal((seenInit?.headers as Record<string, string>).Authorization, 'Bearer test-key');
  assert.equal(result.content, 'Привет');
  assert.deepEqual(result.usage, { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 });
});

test('callUpstream Anthropic: system отдельно, x-api-key, content parts', async () => {
  let seenUrl = '';
  let seenBody: Record<string, unknown> = {};
  const fetchFn: FetchFn = (url, init) => {
    seenUrl = url;
    seenBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Promise.resolve(
      okJson({
        model: 'claude-test',
        content: [
          { type: 'text', text: 'Часть 1.' },
          { type: 'text', text: ' Часть 2.' },
        ],
        usage: { input_tokens: 4, output_tokens: 6 },
      }),
    );
  };
  const result = await callUpstream(
    anthropic,
    { messages: [msg.system('Ты ассистент'), msg.user('hi')] },
    fetchFn,
  );
  assert.equal(seenUrl, 'https://anthropic.example/v1/messages');
  assert.equal(seenBody.system, 'Ты ассистент');
  assert.deepEqual(seenBody.messages, [{ role: 'user', content: 'hi' }]);
  assert.equal(seenBody.max_tokens, 1024);
  assert.equal(result.content, 'Часть 1. Часть 2.');
  assert.deepEqual(result.usage, { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 });
});

test('callUpstream: upstream error -> UpstreamError только со статусом', async () => {
  const fetchFn: FetchFn = () =>
    Promise.resolve(new Response('body with test-key', { status: 500 }));
  await assert.rejects(
    () => callUpstream(openai, { messages: [msg.user('hi')] }, fetchFn),
    (err: unknown) => {
      assert.ok(err instanceof UpstreamError);
      assert.equal(err.status, 500);
      assert.ok(!err.message.includes('test-key'));
      return true;
    },
  );
});
