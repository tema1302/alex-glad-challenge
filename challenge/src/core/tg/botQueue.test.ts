import test from 'node:test';
import assert from 'node:assert/strict';
import { splitText, OutboxQueue, CooldownLimiter, SendError } from './botQueue.js';
import type { OutboundMessage } from './botQueue.js';

test('splitText: короткий текст не режется', () => {
  assert.deepEqual(splitText('привет'), ['привет']);
});

test('splitText: лимит кусков ≤3900 и полнота содержимого', () => {
  const text = Array.from({ length: 4000 }, (_, i) => `строка ${i} — хвост`).join('\n');
  const chunks = splitText(text, 3900);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= 3900);
  const rejoined = chunks.join('\n');
  assert.equal(rejoined.replace(/\s+/g, ' ').length, text.replace(/\s+/g, ' ').length);
  assert.ok(rejoined.includes('строка 0'));
  assert.ok(rejoined.includes('строка 3999'));
});

test('splitText: абзац без переносов жёстко режется по границе', () => {
  const text = 'а'.repeat(8000);
  const chunks = splitText(text, 3900);
  assert.equal(chunks.length, 3);
  assert.ok(chunks.every((c) => c.length <= 3900));
  assert.equal(chunks.join('').length, 8000);
});

test('splitText: режет по границе строки внутри окна', () => {
  const first = 'х'.repeat(3000);
  const text = `${first}\nкороткий хвост\n${'у'.repeat(3000)}`;
  const chunks = splitText(text, 3900);
  assert.equal(chunks.length, 2);
  assert.ok(chunks[0].length <= 3900);
  assert.ok(chunks[0].endsWith('короткий хвост'), 'рез прошёл по границе строки, а не посреди слова');
});

interface Sent {
  text: string;
  at: number;
}

test('OutboxQueue: порядок и гэп между сообщениями чата', async () => {
  const sent: Sent[] = [];
  const queue = new OutboxQueue({
    sender: async (m: OutboundMessage) => {
      sent.push({ text: m.text, at: Date.now() });
      return 1;
    },
    gapMs: 25,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
  await queue.enqueue({ chatId: '1', text: 'первое' });
  await queue.enqueue({ chatId: '1', text: 'второе' });
  assert.deepEqual(sent.map((s) => s.text), ['первое', 'второе']);
  assert.ok(sent[1].at - sent[0].at >= 20, `гэп между сообщениями (в тесте укорочен): ${sent[1].at - sent[0].at} мс`);
  assert.equal(queue.size(), 0);
});

test('OutboxQueue: пагинация 4096 → куски ≤3900 с нумерацией', async () => {
  const sent: Sent[] = [];
  const queue = new OutboxQueue({
    sender: async (m: OutboundMessage) => {
      sent.push({ text: m.text, at: Date.now() });
      return 1;
    },
    gapMs: 1,
    sleep: async () => {},
  });
  const long = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n');
  assert.ok(long.length > 4096);
  await queue.enqueue({ chatId: '1', text: long });
  assert.ok(sent.length > 1);
  for (const s of sent) assert.ok(s.text.length <= 3900 + 8);
  assert.match(sent[0].text, /^1\/\d+\n/);
  assert.match(sent[sent.length - 1].text, /^\d+\/\d+\n/);
});

test('OutboxQueue: 429 → sleep(retry_after+1) и ретрай того же куска', async () => {
  const sent: Sent[] = [];
  const sleeps: number[] = [];
  let attempts = 0;
  const queue = new OutboxQueue({
    sender: async (m: OutboundMessage) => {
      attempts++;
      if (attempts === 1) throw new SendError('Too Many Requests: retry after 2', 2);
      sent.push({ text: m.text, at: Date.now() });
      return 1;
    },
    gapMs: 1,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  await queue.enqueue({ chatId: '1', text: 'цитата' });
  assert.equal(sent.length, 1);
  assert.equal(sleeps[0], 3000);
});

test('OutboxQueue: обычная ошибка → 1 ретрай → дроп (не тишина в логах)', async () => {
  const errors: string[] = [];
  let attempts = 0;
  const queue = new OutboxQueue({
    sender: async () => {
      attempts++;
      throw new Error('сеть недоступна');
    },
    gapMs: 1,
    sleep: async () => {},
    onError: (m) => errors.push(m),
  });
  await queue.enqueue({ chatId: '1', text: 'цитата' });
  assert.equal(attempts, 2);
  assert.equal(errors.length, 1);
});

test('OutboxQueue: message_id пробрасывается наружу', async () => {
  const queue = new OutboxQueue({
    sender: async () => 42,
    gapMs: 1,
    sleep: async () => {},
  });
  assert.equal(await queue.enqueue({ chatId: '1', text: 'анонс' }), 42);
});

test('OutboxQueue: много кусков → id последнего отправленного куска', async () => {
  const sent: string[] = [];
  const queue = new OutboxQueue({
    sender: async (m: OutboundMessage) => {
      sent.push(m.text);
      return sent.length * 10;
    },
    gapMs: 1,
    sleep: async () => {},
  });
  const long = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n');
  assert.ok(long.length > 4096);
  assert.equal(await queue.enqueue({ chatId: '1', text: long }), sent.length * 10);
  assert.ok(sent.length > 1, 'сообщение реально разбито на куски');
});

test('OutboxQueue: кусок дропнут после ретраев → null (даже если первый ушёл)', async () => {
  let n = 0;
  const queue = new OutboxQueue({
    sender: async () => {
      n++;
      if (n > 1) throw new Error('второй кусок не прошёл');
      return 10;
    },
    gapMs: 1,
    sleep: async () => {},
    onError: () => {},
  });
  const long = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n');
  assert.equal(await queue.enqueue({ chatId: '1', text: long }), null);
});

test('OutboxQueue: дроп всего сообщения → null', async () => {
  const queue = new OutboxQueue({
    sender: async () => {
      throw new Error('сеть недоступна');
    },
    gapMs: 1,
    sleep: async () => {},
    onError: () => {},
  });
  assert.equal(await queue.enqueue({ chatId: '1', text: 'цитата' }), null);
});

test('OutboxQueue: legacy-отправитель без возврата id → null', async () => {
  const voidSender = (async () => {}) as unknown as (m: OutboundMessage) => Promise<number | null>;
  const queue = new OutboxQueue({ sender: voidSender, gapMs: 1, sleep: async () => {} });
  assert.equal(await queue.enqueue({ chatId: '1', text: 'цитата' }), null);
});

test('CooldownLimiter: 3/мин, 4-й заблокирован, подсказка раз в 30 с', () => {
  const lim = new CooldownLimiter(3, 60_000, 30_000);
  assert.deepEqual(lim.check('u1', 1000), { allowed: true, hint: false });
  assert.deepEqual(lim.check('u1', 2000), { allowed: true, hint: false });
  assert.deepEqual(lim.check('u1', 3000), { allowed: true, hint: false });
  const fourth = lim.check('u1', 4000);
  assert.equal(fourth.allowed, false);
  assert.equal(fourth.hint, true);
  const fifth = lim.check('u1', 5000);
  assert.equal(fifth.allowed, false);
  assert.equal(fifth.hint, false, 'вторая подсказка в пределах 30 с не шлётся');
  const later = lim.check('u1', 35_000);
  assert.equal(later.allowed, false);
  assert.equal(later.hint, true, 'после 30 с подсказка снова проходит');
});

test('CooldownLimiter: окно очищается и юзеры независимы', () => {
  const lim = new CooldownLimiter(2, 60_000, 30_000);
  assert.equal(lim.check('a', 1000).allowed, true);
  assert.equal(lim.check('a', 2000).allowed, true);
  assert.equal(lim.check('a', 3000).allowed, false);
  assert.equal(lim.check('b', 3000).allowed, true);
  assert.equal(lim.check('a', 61_500).allowed, true, 'после окна счётчик обнулился');
});
