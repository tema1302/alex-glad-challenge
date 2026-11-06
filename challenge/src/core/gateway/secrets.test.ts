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

// ── Day 15 red team hardening: обфускация секретов ──

const FAKE_SK = 'sk-testABCDEFGHIJKLMNOPQRSTUVWXYZ1234';
const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');

test('scanSecrets: split через [..].join(\'\')', () => {
  const code = `const KEY = ['sk-testABC', 'DEFGHIJKLMNOPQRSTUVWXYZ1234'].join('');`;
  const findings = scanSecrets(code);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, 'split_secret');
  assert.equal(findings[0]!.via, 'split');
});

test('scanSecrets: split через concat()', () => {
  const code = `const KEY = 'sk-testABC'.concat('DEFGHIJKLMNOPQRSTUVWXYZ1234');`;
  const findings = scanSecrets(code);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, 'split_secret');
});

test('scanSecrets: split через template literal с ${…}', () => {
  const code = 'const KEY = `sk-${prefix}testABCDEFGHIJKLMNOPQRSTUVWXYZ1234`;';
  const findings = scanSecrets(code);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, 'split_secret');
});

test('scanSecrets: hex-escape последовательность с ключом', () => {
  const hex = [...Buffer.from(FAKE_SK, 'utf8')].map((b) => `\\x${b.toString(16).padStart(2, '0')}`).join('');
  const findings = scanSecrets(`const KEY = "${hex}";`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, 'hex_secret');
  assert.equal(findings[0]!.via, 'hex');
});

test('scanSecrets: double base64', () => {
  const findings = scanSecrets(`const KEY = "${b64(b64(FAKE_SK))}";`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, 'base64_secret');
});

test('scanSecrets: base64, разорванный переносом строки', () => {
  const flat = b64(FAKE_SK);
  const half = Math.floor(flat.length / 2);
  const code = `const KEY = "${flat.slice(0, half)}" +\n  "${flat.slice(half)}";`;
  const findings = scanSecrets(code);
  assert.ok(findings.length >= 1);
  assert.ok(findings.some((f) => f.kind === 'base64_secret' || f.kind === 'split_secret'));
});

test('scanSecrets: base64 с пробелами внутри токена', () => {
  const flat = b64(FAKE_SK);
  const spaced = `${flat.slice(0, 10)} ${flat.slice(10, 20)} ${flat.slice(20)}`;
  const findings = scanSecrets(`const KEY = "${spaced}";`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, 'base64_secret');
});

test('scanSecrets: чистые join/template не дают ложных срабатываний', () => {
  assert.deepEqual(scanSecrets(`const msg = ['Hello', 'World'].join(', ');`), []);
  assert.deepEqual(scanSecrets('const msg = `Привет, ${name}, тебе ${age} лет`;'), []);
  assert.deepEqual(scanSecrets(`const label = 'a'.concat('b', 'c');`), []);
});

test('maskSecrets: маскирует split/hex/ws-base64', () => {
  const joinMasked = maskSecrets(`const KEY = ['sk-testABC', 'DEFGHIJKLMNOPQRSTUVWXYZ1234'].join('');`);
  assert.ok(joinMasked.includes(REDACTION.split));
  assert.ok(!joinMasked.includes('sk-testABC'));

  const hex = [...Buffer.from(FAKE_SK, 'utf8')].map((b) => `\\x${b.toString(16).padStart(2, '0')}`).join('');
  const hexMasked = maskSecrets(`const KEY = "${hex}";`);
  assert.ok(hexMasked.includes(REDACTION.hex));
  assert.ok(!hexMasked.includes(hex));

  const flat = b64(FAKE_SK);
  const spaced = `${flat.slice(0, 10)} ${flat.slice(10, 20)} ${flat.slice(20)}`;
  const wsMasked = maskSecrets(`const KEY = "${spaced}";`);
  assert.ok(wsMasked.includes(REDACTION.base64));
  assert.ok(!wsMasked.includes(flat.slice(0, 10)));
});
