// Тесты LlmClient: гигиена ошибок (нет утечки тела ответа провайдера).
// Регрессия issue #139: chatRaw при !resp.ok включал тело ответа в Error —
// оно может уйти в логи/наружу через safeMessage (он не чистит произвольные тела).

import test from 'node:test';
import assert from 'node:assert/strict';

import { LlmClient } from './client.js';
import { msg } from './types.js';

// Секретный маркер как будто вернул провайдер (квоты, модели, отражённый промпт).
const SECRET = 'SECRET-PROVIDER-PAYLOAD-42';

function providerClient(): LlmClient {
  // Loopback-адрес валиден: fetch замокан, сети нет.
  return new LlmClient({ baseUrl: 'http://127.0.0.1:9', apiKey: 'test-key', defaultModel: 'test' });
}

test('chatRaw: ошибка API не содержит тело ответа провайдера (только статус)', async (t) => {
  const mocked = () =>
    new Response(JSON.stringify({ error: { message: SECRET } }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    });
  t.mock.method(globalThis, 'fetch', mocked);

  await assert.rejects(
    providerClient().chatRaw({ model: 'test', messages: [msg.user('привет')] }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /LLM API error 429/);
      assert.ok(!err.message.includes(SECRET), 'тело ответа не должно попадать в Error');
      return true;
    },
  );
});

test('chatRaw: ок-ответ не тронут (регресс не ломает happy path)', async (t) => {
  const mocked = () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: 'ок' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  t.mock.method(globalThis, 'fetch', mocked);

  const content = await providerClient().chatRaw({ model: 'test', messages: [msg.user('привет')] });
  assert.equal(content.choices[0]?.message?.content, 'ок');
});

// Регрессия LLM 400: непарный суррогат (половинка emoji) в сообщении —
// JSON.stringify экранирует его как \udXXX, строгий парсер провайдера
// (DeepSeek) отклоняет тело запроса с 400. Клиент не должен их отправлять.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

test('chatRaw: непарные суррогаты не уходят в тело запроса', async (t) => {
  let sentBody = '';
  const mocked = (_url: unknown, init: { body: string }) => {
    sentBody = init.body;
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ок' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  t.mock.method(globalThis, 'fetch', mocked);

  await providerClient().chatRaw({ model: 'test', messages: [msg.user('текст\ud83e и 🤣')] });
  const parsed = JSON.parse(sentBody) as { messages: Array<{ content: string }> };
  assert.ok(!LONE_SURROGATE.test(parsed.messages[0].content), 'контент очищен от непарных суррогатов');
  assert.ok(parsed.messages[0].content.includes('🤣'), 'целые emoji сохранены');
});

test('chatStream: непарные суррогаты не уходят в тело запроса', async (t) => {
  let sentBody = '';
  const mocked = (_url: unknown, init: { body: string }) => {
    sentBody = init.body;
    return new Response('data: [DONE]\n\n', { status: 200 });
  };
  t.mock.method(globalThis, 'fetch', mocked);

  for await (const _chunk of providerClient().chatStream([msg.user('текст\ud83e')])) {
    // поток пуст ([DONE] сразу) — важен только факт отправки запроса
  }
  const parsed = JSON.parse(sentBody) as { messages: Array<{ content: string }> };
  assert.ok(!LONE_SURROGATE.test(parsed.messages[0].content));
});
