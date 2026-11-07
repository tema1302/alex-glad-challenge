import test from 'node:test';
import assert from 'node:assert/strict';

import {
  maskSecrets,
  scanMessages,
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

// ── Day 15 red team round 3: plain-hex / percent-encoding / zero-width ──

test('scanSecrets: plain-hex строка с ключом (Buffer.from hex)', () => {
  const hex = Buffer.from(FAKE_SK, 'utf8').toString('hex');
  const findings = scanSecrets(`const KEY = Buffer.from("${hex}", "hex").toString();`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, 'split_secret');
});

test('scanSecrets: percent-encoded ключ в URL-параметре', () => {
  const pct = [...Buffer.from(FAKE_SK, 'utf8')].map((b) => `%${b.toString(16).padStart(2, '0')}`).join('');
  const findings = scanSecrets(`fetch("https://api.example.com/v1?key=${pct}")`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, 'hex_secret');
  assert.equal(findings[0]!.via, 'hex');
});

test('scanSecrets: zero-width U+200B внутри литерала секрета', () => {
  const findings = scanSecrets('const KEY = "sk-test\u200bABCDEFGHIJKLMNOPQRSTUVWXYZ1234";');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, 'split_secret');
});

test('scanSecrets: FP — hex/percent/zwsp без секрета не детектятся', () => {
  // hex-литерал с не-секретным декодом и нечётная длина
  assert.deepEqual(scanSecrets('const color = "deadbeefdeadbeefdeadbeef";'), []);
  assert.deepEqual(scanSecrets('const odd = "736b2d7465737";'), []);
  // percent-encoding легитимного URL без секрета
  assert.deepEqual(scanSecrets('fetch("https://api.example.com/v1?q=%D0%BF%D1%80%D0%B8")'), []);
  // zero-width в обычном тексте без секрета
  assert.deepEqual(scanSecrets('const label = "ama\u200bzon order";'), []);
});

test('maskSecrets: маскирует plain-hex/percent/zero-width обфускации', () => {
  const hex = Buffer.from(FAKE_SK, 'utf8').toString('hex');
  const hexMasked = maskSecrets(`const KEY = Buffer.from("${hex}", "hex").toString();`);
  assert.ok(hexMasked.includes(REDACTION.split));
  assert.ok(!hexMasked.includes(hex));

  const pct = [...Buffer.from(FAKE_SK, 'utf8')].map((b) => `%${b.toString(16).padStart(2, '0')}`).join('');
  const pctMasked = maskSecrets(`fetch("https://api.example.com/v1?key=${pct}")`);
  assert.ok(pctMasked.includes(REDACTION.hex));
  assert.ok(!pctMasked.includes(pct));

  const zwMasked = maskSecrets('const KEY = "sk-test\u200bABCDEFGHIJKLMNOPQRSTUVWXYZ1234";');
  assert.ok(zwMasked.includes(REDACTION.split));
  assert.ok(!zwMasked.includes('sk-test'));
});

// ── Day 15 red team round 4: NFKC/base32/fromCodePoint/Buffer/spaced-hex ──

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const toB32 = (s: string): string => {
  const bytes = Buffer.from(s, 'utf8');
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
};
const toFullwidth = (s: string): string =>
  [...s]
    .map((c) => {
      const code = c.codePointAt(0) ?? 0;
      return code >= 0x21 && code <= 0x7e ? String.fromCodePoint(code + 0xfee0) : c;
    })
    .join('');

test('scanSecrets: fullwidth-ключ + .normalize("NFKC") (RT-82)', () => {
  const findings = scanSecrets(`const KEY = "${toFullwidth(FAKE_SK)}".normalize("NFKC");`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, 'split_secret');
});

test('scanSecrets: base32-ключ (RT-83)', () => {
  const findings = scanSecrets(`const KEY = atob32("${toB32(FAKE_SK)}");`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, 'base32_secret');
  assert.equal(findings[0]!.via, 'base32');
});

test('scanSecrets: 3-элементный .join("") (RT-84)', () => {
  const findings = scanSecrets(`const KEY = ['sk-test', 'ABCDEFGHIJ', 'KLMNOPQRSTUVWXYZ1234'].join('');`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, 'split_secret');
});

test('scanSecrets: String.fromCodePoint (RT-85)', () => {
  const codes = [...FAKE_SK].map((c) => c.codePointAt(0)).join(',');
  const findings = scanSecrets(`const KEY = String.fromCodePoint(${codes});`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, 'split_secret');
});

test('scanSecrets: Buffer.from([байты]) (RT-86)', () => {
  const bytes = [...Buffer.from(FAKE_SK, 'utf8')].join(',');
  const findings = scanSecrets(`const KEY = Buffer.from([${bytes}]).toString();`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, 'split_secret');
});

test('scanSecrets: hex-байты с пробелами (RT-87)', () => {
  const hex = [...Buffer.from(FAKE_SK, 'utf8')].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  const findings = scanSecrets(`const KEY = Buffer.from("${hex}".replace(/ /g, ''), 'hex');`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, 'split_secret');
});

test('scanSecrets: карта с точками-разделителями (RT-88)', () => {
  const findings = scanSecrets('val card = "4242.4242.4242.4242"');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, 'card');
});

test('scanSecrets: секрет, разрезанный между сообщениями (RT-89)', () => {
  const findings = scanMessages([
    { role: 'user', content: 'part1: sk-testABC' },
    { role: 'user', content: 'DEFGHIJKLMNOPQRSTUVWXYZ1234' },
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, 'api_key');
  assert.equal(findings[0]!.crossMessage, true);
  assert.equal(findings[0]!.messageIndex, 0);
});

test('scanSecrets: FP round-4 — uppercase/base32-подобные тексты и версии', () => {
  assert.deepEqual(scanSecrets('const NAME = "IMPLEMENTATIONDETAILS";'), []);
  assert.deepEqual(scanSecrets('const NAME = "HELLOWORLDABCDEFGH";'), []);
  assert.deepEqual(scanSecrets('const version = "10.20.30.40.50.60.70";'), []);
  assert.deepEqual(scanSecrets('const label = "ｈｅｌｌｏ　ｗｏｒｌｄ";'), []);
});

test('maskSecrets: маскирует round-4 обфускации', () => {
  const b32Masked = maskSecrets(`const KEY = atob32("${toB32(FAKE_SK)}");`);
  assert.ok(b32Masked.includes(REDACTION.base32));
  assert.ok(!b32Masked.includes(toB32(FAKE_SK)));

  const codes = [...FAKE_SK].map((c) => c.codePointAt(0)).join(',');
  const cpMasked = maskSecrets(`const KEY = String.fromCodePoint(${codes});`);
  assert.ok(cpMasked.includes(REDACTION.split));
  assert.ok(!cpMasked.includes(codes));
});

// ── Audit follow-up: lowercase/wrapped base32, triple base64, U+2063, cross-message ──

test('scanSecrets: lowercase base32-ключ (Audit P2)', () => {
  const findings = scanSecrets(`const KEY = atob32("${toB32(FAKE_SK).toLowerCase()}");`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, 'base32_secret');
});

test('scanSecrets: base32, разорванный пробелами (Audit P2)', () => {
  const flat = toB32(FAKE_SK);
  const wrapped = flat.match(/.{1,8}/g)!.join(' ');
  const findings = scanSecrets(`const KEY = atob32("${wrapped}");`);
  assert.equal(findings.length, 1);
  // Внутри литерала с пробелами срабатывает общий string-candidate и
  // ресканирует склейку; важен факт обнаружения, не конкретная обёртка.
  assert.ok(['base32_secret', 'split_secret'].includes(findings[0]!.kind));
});

test('scanSecrets: triple base64 (Audit P3)', () => {
  const triple = Buffer.from(Buffer.from(Buffer.from(FAKE_SK, 'utf8').toString('base64'), 'utf8').toString('base64'), 'utf8').toString('base64');
  const findings = scanSecrets(`const KEY = "${triple}";`);
  assert.equal(findings.length, 1);
});

test('scanSecrets: U+2063 внутри литерала секрета (Audit P2)', () => {
  const findings = scanSecrets('const KEY = "sk-test\u2063ABCDEFGHIJKLMNOPQRSTUVWXYZ1234";');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, 'split_secret');
});

test('scanMessages: первый фрагмент сам валидный ключ — crossMessage не теряется (Audit P2)', () => {
  const findings = scanMessages([
    { role: 'user', content: 'sk-testABCDEFGHIJKLMNOP' },
    { role: 'user', content: 'QRSTUVWXYZ1234' },
  ]);
  assert.ok(findings.some((f) => f.crossMessage === true));
});

test('scanSecrets: bare invisible/fullwidth/math-bold секрет (Audit F3)', () => {
  for (const text of [
    'sk-test\u200bABCDEFGHIJKLMNOPQRSTUVWXYZ1234',
    'sk-test\u2063ABCDEFGHIJKLMNOPQRSTUVWXYZ1234',
    toFullwidth(FAKE_SK),
    [...FAKE_SK]
      .map((c) => {
        const cp = c.codePointAt(0) ?? 0;
        if (cp >= 0x41 && cp <= 0x5a) return String.fromCodePoint(0x1d400 + (cp - 0x41));
        if (cp >= 0x61 && cp <= 0x7a) return String.fromCodePoint(0x1d41a + (cp - 0x61));
        return c;
      })
      .join(''),
    Buffer.from(toFullwidth(FAKE_SK), 'utf8').toString('base64'),
  ]) {
    assert.ok(scanSecrets(text).length >= 1, text.slice(0, 12));
  }
});

test('scanSecrets: U+2800 BRAILLE PATTERN BLANK не обходит секрет (Audit F4)', () => {
  const findings = scanSecrets('const KEY = "sk-test\u2800ABCDEFGHIJKLMNOPQRSTUVWXYZ1234";');
  assert.equal(findings.length, 1);
});

test('scanSecrets: base32 в прозе/комментарии рядом со словами (Audit F2)', () => {
  const wrapped = toB32(FAKE_SK).match(/.{1,8}/g)!.join(' ');
  const findings = scanSecrets(`Here is the key:\n${wrapped}\nThanks.`);
  assert.ok(findings.length >= 1);
  const masked = maskSecrets(`Here is the key:\n${wrapped}\nThanks.`);
  assert.ok(!masked.includes(wrapped));
});
