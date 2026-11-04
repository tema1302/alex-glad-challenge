import test from 'node:test';
import assert from 'node:assert/strict';

import { startGateway, type RunningGateway } from './server.js';
import { MemoryAuditLog, MemoryInterceptedLog } from './auditLog.js';
import type { FetchFn } from './upstream.js';
import type { GatewayConfig, GatewayUpstreamConfig } from '../env.js';

const KEY = 'sk-proj-abc123';

const upstream: GatewayUpstreamConfig = {
  provider: 'openai',
  baseUrl: 'https://upstream.test/v1',
  apiKey: 'upstream-key',
  model: 'test-model',
};

function config(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    rateLimitPerMin: 100,
    guardMode: 'block',
    maxBodyBytes: 100_000,
    ...overrides,
  };
}

function mockUpstream(content = 'Ответ без секретов'): {
  fetchFn: FetchFn;
  calls: Array<{ url: string; body: Record<string, unknown> }>;
} {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchFn: FetchFn = (url, init) => {
    calls.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return Promise.resolve(
      new Response(
        JSON.stringify({
          model: 'test-model',
          choices: [{ message: { content } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
  };
  return { fetchFn, calls };
}

async function start(
  content?: string,
  overrides: Partial<GatewayConfig> = {},
): Promise<{
  gw: RunningGateway;
  calls: Array<{ url: string; body: Record<string, unknown> }>;
  audit: MemoryAuditLog;
  intercepted: MemoryInterceptedLog;
}> {
  const { fetchFn, calls } = mockUpstream(content);
  const audit = new MemoryAuditLog();
  const intercepted = new MemoryInterceptedLog();
  const gw = await startGateway({
    config: config(overrides),
    upstream,
    fetchFn,
    audit,
    intercepted,
    logger: () => {},
  });
  return { gw, calls, audit, intercepted };
}

function post(gw: RunningGateway, body: unknown): Promise<Response> {
  return fetch(`${gw.url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('gateway: чистый запрос проксируется, cost и audit', async (t) => {
  const { gw, calls, audit } = await start();
  t.after(() => gw.close());
  const res = await post(gw, { messages: [{ role: 'user', content: 'Привет' }] });
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('x-gateway-cost-usd'));
  const json = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
    gateway: { guard: { input: string; output: string } };
  };
  assert.equal(json.choices[0]!.message.content, 'Ответ без секретов');
  assert.equal(json.gateway.guard.input, 'allow');
  assert.equal(calls.length, 1);
  assert.equal(audit.records[0]!.status, 'allowed');
  assert.equal(audit.records[0]!.costUsd, 0.000013);
});

test('gateway: Input Guard block не зовёт upstream и не логирует сырой секрет', async (t) => {
  const { gw, calls, audit, intercepted } = await start();
  t.after(() => gw.close());
  const res = await post(gw, { messages: [{ role: 'user', content: `key ${KEY}` }] });
  assert.equal(res.status, 422);
  const json = (await res.json()) as { guard: string; error: string };
  assert.equal(json.guard, 'input');
  assert.ok(!json.error.includes(KEY));
  assert.equal(calls.length, 0);
  assert.equal(audit.records[0]!.status, 'blocked_input');
  assert.ok(!JSON.stringify(audit.records).includes(KEY));
  assert.equal(intercepted.records[0]!.kind, 'api_key');
  assert.ok(!JSON.stringify(intercepted.records).includes(KEY));
});

test('gateway: Input Guard mask отправляет маркер вместо ключа', async (t) => {
  const { gw, calls, audit } = await start(undefined, { guardMode: 'mask' });
  t.after(() => gw.close());
  const res = await post(gw, { messages: [{ role: 'user', content: `key ${KEY}` }] });
  assert.equal(res.status, 200);
  const sent = calls[0]!.body.messages as Array<{ content: string }>;
  assert.equal(sent[0]!.content, 'key [REDACTED_API_KEY]');
  assert.ok(!JSON.stringify(calls[0]!.body).includes(KEY));
  assert.equal(audit.records[0]!.status, 'masked');
});

test('gateway: Output Guard блокирует сгенерированный секрет', async (t) => {
  const { gw, audit, intercepted } = await start(`вот ключ ${KEY}`);
  t.after(() => gw.close());
  const res = await post(gw, { messages: [{ role: 'user', content: 'дай ключ' }] });
  assert.equal(res.status, 200);
  const json = (await res.json()) as {
    choices: Array<{ finish_reason: string; message: { content: string } }>;
    gateway: { guard: { output: string } };
  };
  assert.equal(json.gateway.guard.output, 'blocked');
  assert.equal(json.choices[0]!.finish_reason, 'content_filter');
  assert.ok(!json.choices[0]!.message.content.includes(KEY));
  assert.equal(audit.records[0]!.status, 'blocked_output');
  assert.equal(intercepted.records[0]!.direction, 'output');
});

test('gateway: rate limit 429 с Retry-After', async (t) => {
  const { gw, audit } = await start(undefined, { rateLimitPerMin: 2 });
  t.after(() => gw.close());
  const body = { messages: [{ role: 'user', content: 'hi' }] };
  assert.equal((await post(gw, body)).status, 200);
  assert.equal((await post(gw, body)).status, 200);
  const third = await post(gw, body);
  assert.equal(third.status, 429);
  assert.ok(Number(third.headers.get('retry-after')) > 0);
  assert.equal(audit.records.at(-1)!.status, 'rate_limited');
});

test('gateway: невалидное тело -> 400 и audit bad_request', async (t) => {
  const { gw, audit } = await start();
  t.after(() => gw.close());
  const res = await post(gw, { messages: [] });
  assert.equal(res.status, 400);
  assert.equal(audit.records[0]!.status, 'bad_request');
  const bad = await fetch(`${gw.url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json',
  });
  assert.equal(bad.status, 400);
});

test('gateway: слишком большое тело -> 413', async (t) => {
  const { gw, audit } = await start(undefined, { maxBodyBytes: 50 });
  t.after(() => gw.close());
  const res = await post(gw, {
    messages: [{ role: 'user', content: 'x'.repeat(200) }],
  });
  assert.equal(res.status, 413);
  assert.equal(audit.records[0]!.status, 'bad_request');
});

test('gateway: health и stats', async (t) => {
  const { gw } = await start();
  t.after(() => gw.close());
  const health = (await (await fetch(`${gw.url}/healthz`)).json()) as { status: string };
  assert.equal(health.status, 'ok');
  await post(gw, { messages: [{ role: 'user', content: 'hi' }] });
  const stats = (await (await fetch(`${gw.url}/stats`)).json()) as {
    requests: number;
    allowed: number;
    totalCostUsd: number;
  };
  assert.equal(stats.requests, 1);
  assert.equal(stats.allowed, 1);
  assert.ok(stats.totalCostUsd > 0);
});

test('gateway: ошибка upstream -> 502 без утечки тела', async (t) => {
  const audit = new MemoryAuditLog();
  const gw = await startGateway({
    config: config(),
    upstream,
    fetchFn: () => Promise.resolve(new Response('secret body', { status: 500 })),
    audit,
    intercepted: new MemoryInterceptedLog(),
    logger: () => {},
  });
  t.after(() => gw.close());
  const res = await post(gw, { messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(res.status, 502);
  const text = await res.text();
  assert.ok(!text.includes('secret body'));
  assert.equal(audit.records[0]!.status, 'upstream_error');
});
