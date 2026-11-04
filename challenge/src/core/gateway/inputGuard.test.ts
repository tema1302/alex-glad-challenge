import test from 'node:test';
import assert from 'node:assert/strict';

import { guardInput } from './inputGuard.js';
import { msg } from '../types.js';

const OPENAI_KEY = 'sk-proj-abc123';

test('guardInput: block по умолчанию не пропускает ключ и возвращает warning', () => {
  const result = guardInput([msg.user(`мой ключ ${OPENAI_KEY}`)]);
  assert.equal(result.action, 'blocked');
  assert.equal(result.findings.length, 1);
  assert.ok(result.warning?.includes('заблокирован'));
  assert.ok(!result.warning?.includes(OPENAI_KEY));
});

test('guardInput: mask заменяет секрет и пропускает сообщения', () => {
  const result = guardInput([msg.user(`мой ключ ${OPENAI_KEY}`)], { mode: 'mask' });
  assert.equal(result.action, 'masked');
  assert.equal(result.messages[0]!.content, 'мой ключ [REDACTED_API_KEY]');
  assert.ok(result.warning?.includes('замаскированы'));
});

test('guardInput: чистый промпт allow без warning', () => {
  const result = guardInput([msg.system('Ты помощник.'), msg.user('Как дела?')]);
  assert.equal(result.action, 'allow');
  assert.equal(result.warning, null);
  assert.equal(result.findings.length, 0);
});

test('guardInput: находки привязаны к индексу сообщения', () => {
  const result = guardInput([
    msg.system('Ты помощник.'),
    msg.user('email: user@example.com'),
  ]);
  assert.equal(result.action, 'blocked');
  assert.equal(result.findings[0]!.messageIndex, 1);
});
