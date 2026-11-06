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
  // Один задедупленный спан: ws-base64-путь или более широкий split-кандидат.
  assert.ok(
    findings[0]!.kind === 'base64_secret' || findings[0]!.kind === 'split_secret',
    `unexpected kind ${findings[0]!.kind}`,
  );
});

test('scanSecrets: чистые join/template не дают ложных срабатываний', () => {
  assert.deepEqual(scanSecrets(`const msg = ['Hello', 'World'].join(', ');`), []);
  assert.deepEqual(scanSecrets('const msg = `Привет, ${name}, тебе ${age} лет`;'), []);
  assert.deepEqual(scanSecrets(`const label = 'a'.concat('b', 'c');`), []);
});

// ── Day 15 red team round 2: fromCharCode / reverse / ws-строка / rot13 / base64url ──

const rot13 = (s: string): string =>
  s.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });

test('scanSecrets: n-ary цепочка «a»+«b»+«c» со сплитом ключа', () => {
  const code = 'const KEY = "sk-testABC" + "DEF" + "GHIJKLMNOPQRSTUVWXYZ1234";';
  const findings = scanSecrets(code);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, 'split_secret');
});

test('scanSecrets: String.fromCharCode с ключом', () => {
  const codes = [...FAKE_SK].map((c) => c.charCodeAt(0)).join(',');
  const findings = scanSecrets(`const K = String.fromCharCode(${codes});`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, 'split_secret');
});

test('scanSecrets: перевёрнутая строка через split/reverse/join', () => {
  const reversed = [...FAKE_SK].reverse().join('');
  const findings = scanSecrets(`const K = "${reversed}".split('').reverse().join('');`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, 'split_secret');
});

test('scanSecrets: секрет с пробелами внутри строки', () => {
  const findings = scanSecrets('const KEY = "sk-test ABCDEFGHIJKLMNOPQRSTUVWXYZ1234";');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, 'split_secret');
});

test('scanSecrets: ROT13-строка с AWS-ключом', () => {
  const findings = scanSecrets(`const K = "${rot13('AKIAIOSFODNNEXAMPLEQ')}".replace(/g, rotDecode);`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, 'split_secret');
});

test('scanSecrets: base64url-токен сканируется как base64', () => {
  const urlSafe = b64(FAKE_SK).replaceAll('+', '-').replaceAll('/', '_');
  const findings = scanSecrets(`const KEY = "${urlSafe}";`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, 'base64_secret');
});

test('scanSecrets: FP — slug/тексты со скобками и ротациями не детектятся', () => {
  assert.deepEqual(scanSecrets('const slug = "naive-bayes-classifier-v2-stable";'), []);
  assert.deepEqual(scanSecrets('const phrase = "the quick brown fox jumps over";'), []);
  assert.deepEqual(scanSecrets(`const r = "${rot13('Internationalization')}";`), []);
  assert.deepEqual(
    scanSecrets('const codes = String.fromCharCode(104, 101, 108, 108, 111);'),
    [],
  );
  assert.deepEqual(scanSecrets('const label = "iteration-count-v2".split("").length;'), []);
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
  // Секрет нейтрализован: split-кандидатом (шире спан) или ws-base64-маской.
  assert.ok(
    wsMasked.includes(REDACTION.split) || wsMasked.includes(REDACTION.base64),
    wsMasked,
  );
  assert.ok(!wsMasked.includes(flat.slice(0, 10)));
});
