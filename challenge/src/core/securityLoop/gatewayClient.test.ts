import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertLoopbackGatewayUrl,
  GatewayBlockedError,
  GatewayClient,
  GatewayHttpError,
  type GatewayFetchFn,
} from './gatewayClient.js';

function jsonResponse(
  payload: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const messages = [{ role: 'user' as const, content: 'hello' }];

test('assertLoopbackGatewayUrl: loopback разрешён, внешний хост/креды — нет', () => {
  assert.equal(assertLoopbackGatewayUrl('http://127.0.0.1:3040'), 'http://127.0.0.1:3040');
  assert.equal(assertLoopbackGatewayUrl('http://localhost:3040'), 'http://localhost:3040');
  assert.equal(assertLoopbackGatewayUrl('http://[::1]:3040'), 'http://[::1]:3040');
  assert.throws(() => assertLoopbackGatewayUrl('https://gateway.example.com'), /loopback/);
  assert.throws(() => assertLoopbackGatewayUrl('http://user:pass@127.0.0.1:3040'), /credentials/);
  assert.throws(() => assertLoopbackGatewayUrl('ftp://127.0.0.1:3040'), /http/);
  assert.throws(() => assertLoopbackGatewayUrl('not a url'), /invalid/);
  assert.throws(
    () => new GatewayClient({ baseUrl: 'https://gateway.example.com' }),
    /loopback/,
  );
});

test('GatewayClient: успешный вызов + requestId/guard/cost', async () => {
  let body: Record<string, unknown> = {};
  let seenInit: RequestInit | undefined;
  const fetchFn: GatewayFetchFn = async (_url, init) => {
    seenInit = init;
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return jsonResponse(
      {
        choices: [{ message: { role: 'assistant', content: 'class A {}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        gateway: {
          requestId: 'gw_1',
          guard: { input: 'allow', output: 'allow' },
          costUsd: 0.001,
          warning: null,
        },
      },
      200,
      { 'x-request-id': 'gw_1' },
    );
  };

  const client = new GatewayClient({ baseUrl: 'http://127.0.0.1:3040/', fetchFn });
  const result = await client.chat(messages, {
    stage: 'generation',
    temperature: 0.1,
    maxTokens: 123,
  });

  assert.equal(result.content, 'class A {}');
  assert.deepEqual(result.info, {
    stage: 'generation',
    requestId: 'gw_1',
    input: 'allow',
    output: 'allow',
    warning: null,
    costUsd: 0.001,
  });
  assert.equal(body.model, undefined);
  assert.equal(body.temperature, 0.1);
  assert.equal(body.max_tokens, 123);
  assert.deepEqual(body.messages, messages);
  const headers = new Headers(seenInit?.headers);
  assert.equal(headers.get('content-type'), 'application/json');
  assert.equal(headers.get('authorization'), null);
});

test('GatewayClient: model override уходит в тело', async () => {
  let body: Record<string, unknown> = {};
  const fetchFn: GatewayFetchFn = async (_url, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return jsonResponse({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      gateway: { guard: { input: 'allow', output: 'allow' } },
    });
  };
  const client = new GatewayClient({ baseUrl: 'http://127.0.0.1:3040', model: 'test-model', fetchFn });
  await client.chat(messages);
  assert.equal(body.model, 'test-model');
});

test('GatewayClient: 422 input block → GatewayBlockedError', async () => {
  const fetchFn: GatewayFetchFn = async () =>
    jsonResponse(
      {
        error: 'blocked',
        guard: 'input',
        findings: [{ kind: 'api_key', severity: 'critical', preview: 'sk-p***23' }],
      },
      422,
      { 'x-request-id': 'gw_block' },
    );
  const client = new GatewayClient({ baseUrl: 'http://127.0.0.1:3040', fetchFn });
  await assert.rejects(
    () => client.chat(messages),
    (err: unknown) => {
      assert.ok(err instanceof GatewayBlockedError);
      assert.equal(err.direction, 'input');
      assert.equal(err.status, 422);
      assert.equal(err.requestId, 'gw_block');
      assert.equal(err.findings[0]!.kind, 'api_key');
      assert.ok(!JSON.stringify(err).includes('sk-proj'));
      return true;
    },
  );
});

test('GatewayClient: 200 content_filter → blocked output', async () => {
  const fetchFn: GatewayFetchFn = async () =>
    jsonResponse({
      choices: [{ message: { content: '[BLOCKED]' }, finish_reason: 'content_filter' }],
      gateway: {
        requestId: 'gw_out',
        guard: { input: 'allow', output: 'blocked' },
        warning: 'Output Guard: ответ заблокирован (api_key)',
      },
    });
  const client = new GatewayClient({ baseUrl: 'http://127.0.0.1:3040', fetchFn });
  await assert.rejects(
    () => client.chat(messages),
    (err: unknown) => {
      assert.ok(err instanceof GatewayBlockedError);
      assert.equal(err.direction, 'output');
      assert.equal(err.requestId, 'gw_out');
      assert.ok(err.warning?.includes('api_key'));
      return true;
    },
  );
});

test('GatewayClient: masked/redacted попадают в info', async () => {
  const fetchFn: GatewayFetchFn = async () =>
    jsonResponse({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      gateway: {
        guard: { input: 'masked', output: 'redacted' },
        warning: 'Input Guard: masked',
      },
    });
  const client = new GatewayClient({ baseUrl: 'http://127.0.0.1:3040', fetchFn });
  const result = await client.chat(messages);
  assert.equal(result.info.input, 'masked');
  assert.equal(result.info.output, 'redacted');
  assert.equal(result.info.warning, 'Input Guard: masked');
});

test('GatewayClient: сеть недоступна → GatewayHttpError(0), без URL', async () => {
  const fetchFn: GatewayFetchFn = async () => {
    throw new Error('connect ECONNREFUSED http://127.0.0.1:3040?key=secret');
  };
  const client = new GatewayClient({ baseUrl: 'http://127.0.0.1:3040', fetchFn });
  await assert.rejects(
    () => client.chat(messages),
    (err: unknown) => {
      assert.ok(err instanceof GatewayHttpError);
      assert.equal(err.status, 0);
      assert.ok(!err.message.includes('secret'));
      return true;
    },
  );
});

test('GatewayClient: 502 без тела → GatewayHttpError(502)', async () => {
  const fetchFn: GatewayFetchFn = async () => new Response('bad gateway', { status: 502 });
  const client = new GatewayClient({ baseUrl: 'http://127.0.0.1:3040', fetchFn });
  await assert.rejects(
    () => client.chat(messages),
    (err: unknown) => {
      assert.ok(err instanceof GatewayHttpError);
      assert.equal(err.status, 502);
      return true;
    },
  );
});

test('GatewayClient: пустой content → GatewayHttpError(502)', async () => {
  const fetchFn: GatewayFetchFn = async () =>
    jsonResponse({
      choices: [{ message: { content: '' }, finish_reason: 'stop' }],
      gateway: { guard: { input: 'allow', output: 'allow' } },
    });
  const client = new GatewayClient({ baseUrl: 'http://127.0.0.1:3040', fetchFn });
  await assert.rejects(
    () => client.chat(messages),
    (err: unknown) => err instanceof GatewayHttpError && err.status === 502,
  );
});
