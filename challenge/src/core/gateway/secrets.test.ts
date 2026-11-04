import test from 'node:test';
import assert from 'node:assert/strict';

import {
  maskSecrets,
  scanSecrets,
  summarizeFindings,
  REDACTION,
} from './secrets.js';

const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE';
const CARD = '4111 1111 1111 1111';
const OPENAI_KEY = 'sk-proj-abc123';

test('scanSecrets: AWS access key', () => {
  const findings = scanSecrets(`my aws key is ${AWS_KEY}`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, 'aws_key');
  assert.equal(findings[0]!.severity, 'critical');
  assert.ok(!findings[0]!.preview.includes(AWS_KEY));
});

test('scanSecrets: card number проходит Luhn', () => {
  const findings = scanSecrets(`card: ${CARD}`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, 'card');
});

test('scanSecrets: 16 цифр без Luhn не считаются картой', () => {
  const findings = scanSecrets('order 1234 5678 9012 3456');
  assert.equal(findings.filter((f) => f.kind === 'card').length, 0);
});

test('scanSecrets: base64-encoded OpenAI key', () => {
  const encoded = Buffer.from(OPENAI_KEY, 'utf8').toString('base64');
  const findings = scanSecrets(`token ${encoded}`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, 'base64_secret');
  assert.equal(findings[0]!.via, 'base64');
});

test('scanSecrets: секрет, разбитый конкатенацией', () => {
  const findings = scanSecrets('мой ключ: "sk-" + "proj-abc123"');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, 'split_secret');
  assert.equal(findings[0]!.via, 'split');
});

test('scanSecrets: чистый промпт не даёт находок', () => {
  const findings = scanSecrets('Объясни, как работает event loop в Node.js. Без примеров секретов.');
  assert.deepEqual(findings, []);
});

test('scanSecrets: email и телефон', () => {
  const findings = scanSecrets('Пишите на user@example.com или +7 (999) 123-45-67');
  const kinds = findings.map((f) => f.kind).sort();
  assert.deepEqual(kinds, ['email', 'phone']);
});

test('scanSecrets: GitHub token', () => {
  const findings = scanSecrets(`ghp_${'a'.repeat(36)}`);
  assert.equal(findings[0]!.kind, 'github_token');
});

test('maskSecrets: заменяет ключи маркерами, чистый текст не трогает', () => {
  const src = `key=${OPENAI_KEY} aws=${AWS_KEY} card=${CARD}`;
  const masked = maskSecrets(src);
  assert.ok(masked.includes(REDACTION.apiKey));
  assert.ok(masked.includes(REDACTION.aws));
  assert.ok(masked.includes(REDACTION.card));
  assert.ok(!masked.includes(OPENAI_KEY));
  assert.ok(!masked.includes(AWS_KEY));
  assert.ok(!masked.includes('4111 1111 1111 1111'));
  assert.equal(maskSecrets('hello world'), 'hello world');
});

test('summarizeFindings: только безопасные поля', () => {
  const summary = summarizeFindings(scanSecrets(`key ${OPENAI_KEY}`));
  assert.deepEqual(Object.keys(summary[0]!).sort(), ['kind', 'preview', 'severity', 'via']);
  assert.ok(!JSON.stringify(summary).includes(OPENAI_KEY));
});
