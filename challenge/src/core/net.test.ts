// Регрессия доставки APK: неидемпотентный POST не должен уходить вторым каналом.
// Подменяем сеть, чтобы тест не ходил в Telegram.

import test from 'node:test';
import assert from 'node:assert/strict';

import { netFetch } from './net.js';

const REAL_FETCH = globalThis.fetch;
const REAL_PROXY = process.env['HTTPS_PROXY'];

function stubNetwork(): { attempts: () => number; restore: () => void } {
  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts += 1;
    // Первая попытка (прокси): Telegram принял документ, но ответ потерян.
    if (attempts === 1) throw new Error('socket hang up');
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  process.env['HTTPS_PROXY'] = 'http://fake-proxy.invalid:3128';
  return {
    attempts: () => attempts,
    restore: () => {
      globalThis.fetch = REAL_FETCH;
      if (REAL_PROXY === undefined) delete process.env['HTTPS_PROXY'];
      else process.env['HTTPS_PROXY'] = REAL_PROXY;
    },
  };
}

async function post(opts: Record<string, unknown> = {}) {
  return netFetch('https://api.telegram.org/bot<hidden>/sendDocument', {
    method: 'POST',
    body: new FormData(),
    label: 'Telegram Bot API',
    ...opts,
  });
}

test('netFetch по умолчанию повторяет POST через прямой канал после сетевого фейла', async () => {
  const stub = stubNetwork();
  try {
    const res = await post();
    assert.equal(res.status, 200);
    assert.equal(stub.attempts(), 2);
  } finally {
    stub.restore();
  }
});

test('netFetch с retryOnNetworkError=false отправляет sendDocument один раз', async () => {
  const stub = stubNetwork();
  try {
    await assert.rejects(post({ retryOnNetworkError: false }), /сеть недоступна/);
    assert.equal(stub.attempts(), 1, 'второй POST создал бы дубль в чате');
  } finally {
    stub.restore();
  }
});
