import test from 'node:test';
import assert from 'node:assert/strict';

import { scanSecrets } from '../gateway/secrets.js';
import {
  extractCode,
  generationPrompt,
  numberCode,
  securityReviewPrompt,
  securitySystemPrompt,
  STACK_LABELS,
} from './prompt.js';
import type { CodeTask } from './types.js';

const task: CodeTask = {
  id: 'test-task',
  title: 'Test task',
  prompt: 'Сохрани токен.',
  stack: 'android',
  fileName: 'TokenStore.kt',
  scenario: 'security',
  context: 'class CredentialsStore(file: File)',
  requiredPatterns: [{ label: 'class', re: /class\s+\w+/ }],
};

test('STACK_LABELS: все профили описаны', () => {
  for (const stack of ['android', 'ios', 'web', 'generic'] as const) {
    assert.ok(STACK_LABELS[stack].length > 10);
  }
});

test('securitySystemPrompt(android): Keychain-чеклист, TLS, логи, root', () => {
  const prompt = securitySystemPrompt('android');
  assert.ok(prompt.includes('EncryptedSharedPreferences'));
  assert.ok(prompt.includes('network_security_config'));
  assert.ok(prompt.includes('certificate pinning'));
  assert.ok(prompt.includes('HttpLoggingInterceptor'));
  assert.ok(prompt.includes('root'));
  assert.ok(prompt.includes('allowBackup'));
  assert.ok(prompt.includes('critical'));
  assert.ok(prompt.includes('"findings"'));
});

test('securitySystemPrompt(ios): Keychain vs UserDefaults, ATS, pinning', () => {
  const prompt = securitySystemPrompt('ios');
  assert.ok(prompt.includes('Keychain'));
  assert.ok(prompt.includes('UserDefaults'));
  assert.ok(prompt.includes('ATS'));
  assert.ok(prompt.includes('certificate pinning'));
  assert.ok(prompt.includes('Info.plist'));
});

test('securitySystemPrompt(web): httpOnly, localStorage, SQL, NEXT_PUBLIC', () => {
  const prompt = securitySystemPrompt('web');
  assert.ok(prompt.includes('httpOnly'));
  assert.ok(prompt.includes('localStorage'));
  assert.ok(prompt.includes('parameterized'));
  assert.ok(prompt.includes('NEXT_PUBLIC_'));
  assert.ok(prompt.includes('zod'));
});

test('securitySystemPrompt: не содержит секретов/PII (scanSecrets = 0)', () => {
  for (const stack of ['android', 'ios', 'web', 'generic'] as const) {
    assert.deepEqual(
      scanSecrets(securitySystemPrompt(stack)),
      [],
      `stack ${stack} must be prompt-safe`,
    );
  }
});

test('securityReviewPrompt: код с номерами строк и системный чеклист', () => {
  const messages = securityReviewPrompt(task, 'class TokenStore {}\nfun save() {}');
  assert.equal(messages.length, 2);
  assert.equal(messages[0]!.role, 'system');
  assert.ok(messages[0]!.content.includes('security reviewer'));
  assert.ok(messages[1]!.content.includes('1: class TokenStore {}'));
  assert.ok(messages[1]!.content.includes('2: fun save() {}'));
  assert.ok(messages[1]!.content.includes('Test task') || messages[1]!.content.includes('Сохрани токен'));
});

test('generationPrompt: feedback имеет приоритет, код в fence', () => {
  const messages = generationPrompt(task, 'исправь: plaintext token', null);
  assert.equal(messages.length, 2);
  assert.ok(messages[0]!.content.includes('FEEDBACK SECURITY REVIEW'));
  assert.ok(messages[1]!.content.includes('FEEDBACK SECURITY REVIEW'));
  assert.ok(messages[1]!.content.includes('plaintext token'));
  assert.ok(messages[1]!.content.includes('Контекст кодовой базы'));
});

test('generationPrompt: previousCode маскируется перед отправкой', () => {
  const code = 'val key = "sk-proj-abc123"';
  const messages = generationPrompt(task, null, code);
  const content = messages[1]!.content;
  assert.ok(!content.includes('sk-proj-abc123'));
  assert.ok(content.includes('[REDACTED_API_KEY]'));
});

test('numberCode: 1-based и сохраняет пустые строки', () => {
  assert.equal(numberCode('a\n\nb'), '1: a\n2: \n3: b');
});

test('extractCode: fenced kotlin', () => {
  const raw = 'Вот код:\n```kotlin\nclass A {}\n```\nГотово.';
  assert.equal(extractCode(raw), 'class A {}');
});

test('extractCode: JSON {code}', () => {
  assert.equal(extractCode('{"code":"class B {}"}'), 'class B {}');
});

test('extractCode: json-fence с {code}', () => {
  assert.equal(extractCode('```json\n{"code":"class E {}"}\n```'), 'class E {}');
});

test('extractCode: голый код', () => {
  assert.equal(extractCode('package ru.test\nclass C {}'), 'package ru.test\nclass C {}');
});

test('extractCode: без кода → null', () => {
  assert.equal(extractCode('Не могу помочь.'), null);
});

test('extractCode: выбирает fenced-блок, а не JSON-обёртку', () => {
  const raw = '```json\n{"code":"not a fence"}\n```\n```kotlin\nclass D {}\n```';
  assert.equal(extractCode(raw), 'class D {}');
});
