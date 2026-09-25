import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TgStore } from './tgStore.js';
import type { TgMessageRow } from './tgStore.js';
import { BotStore } from './botStore.js';
import { FtsStore } from './ftsStore.js';
import {
  catchUpFtsIndex,
  BOT_CHAT_KEY,
  BOT_TOPIC_ID,
  BOT_CHANNEL_FROM_ID,
  formatQuoteCard,
  formatGameQuestion,
  truncate,
  formatDate,
} from './bot.js';
import { buildFtsQuery } from './botFtsQuery.js';

const CHAT = BOT_CHAT_KEY; // фикстура в целевом чате — catchUpFtsIndex её подхватывает

// 20 строк: 4 автора (включая бот-канал), NULL-авторы, media-only, разные реакции.
// Длинная «парковочная» строка (i%5==0) всегда с реакциями — кандидат для /игра.
function makeRows(n: number): TgMessageRow[] {
  const authors: Array<[string, string]> = [
    ['100', 'Saveliy'],
    ['200', 'Sevens ABSOLute'],
    ['300', 'krasnobeliy2 Вячеслав'],
    [BOT_CHANNEL_FROM_ID, 'Иди на факты глянь'],
  ];
  const rows: TgMessageRow[] = [];
  for (let i = 1; i <= n; i++) {
    const [fromId, fromName] = authors[i % authors.length];
    const text =
      i % 5 === 0
        ? `парковка у ТТК просто возмутительная ситуация номер ${i}, разобрались ли с разметкой`
        : i % 5 === 1
          ? ''
          : `короткая реплика номер ${i} про футбол`;
    rows.push({
      chat_id: CHAT,
      topic_id: BOT_TOPIC_ID,
      msg_id: i * 10,
      from_id: i % 7 === 0 ? null : fromId,
      from_name: fromName,
      text,
      date_iso: `2024-0${(i % 9) + 1}-15T10:00:00.000Z`,
      reactions_json: '{}',
      reaction_total: i % 5 === 0 ? 6 : i % 3 === 0 ? 5 : i % 3 === 1 ? 3 : 0,
    });
  }
  return rows;
}

interface Stores {
  tg: TgStore;
  bot: BotStore;
  fts: FtsStore;
  dir: string;
  close(): void;
}

function makeStores(): Stores {
  const dir = mkdtempSync(join(tmpdir(), 'factchempik-'));
  const tg = new TgStore(join(dir, 'tg.sqlite'));
  const bot = new BotStore(join(dir, 'tg.sqlite'));
  const fts = new FtsStore(join(dir, 'tg-fts.sqlite'));
  return {
    tg,
    bot,
    fts,
    dir,
    close() {
      tg.close();
      bot.close();
      fts.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('BotStore: state, seed-алиасы, каталог, случайные цитаты, курсор, join', () => {
  const s = makeStores();
  try {
    assert.equal(s.tg.upsertMessages(makeRows(20)).written, 20);

    // state
    s.bot.setState('poll_offset', '42');
    assert.equal(s.bot.getState('poll_offset'), '42');
    assert.equal(s.bot.getState('нет-такого'), null);

    // seed-алиасы: нормализация ключа, идемпотентность, upsert
    assert.equal(s.bot.ensureSeedAliases({ 'севенс': '587493810', 'Савелий': '662123302' }), 2);
    assert.equal(s.bot.ensureSeedAliases({ 'севенс': '587493810' }), 0, 'повторный seed не дублирует');
    assert.equal(s.bot.getAlias('СЕВЕНС '), '587493810', 'нормализация на входе');
    assert.equal(s.bot.getAlias('савелий'), '662123302');
    assert.equal(s.bot.countAliases(), 2);
    s.bot.upsertAlias('севенс', '300');
    assert.equal(s.bot.getAlias('севенс'), '300', 'upsert перезаписывает');

    // каталог авторов: бот-канал и NULL-авторы не участвуют
    const entries = s.bot.getAuthorDirectory(CHAT, BOT_TOPIC_ID, BOT_CHANNEL_FROM_ID);
    const ids = new Set(entries.map((e) => e.fromId));
    assert.ok(!ids.has(BOT_CHANNEL_FROM_ID), 'бот-канал не участник');
    assert.ok(ids.has('100') && ids.has('200') && ids.has('300'));
    const saveliy = entries.filter((e) => e.fromId === '100');
    assert.ok(saveliy.length >= 1);
    assert.ok(saveliy.every((e) => e.name === 'Saveliy'));

    // randomTopQuote: реакции ≥3, без бот-канала и NULL; avoid вычитает пул дочерна
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const row = s.bot.randomTopQuote(CHAT, BOT_TOPIC_ID, {
        minReactions: 3,
        excludeFromId: BOT_CHANNEL_FROM_ID,
      });
      if (!row) break;
      assert.ok(row.reaction_total >= 3);
      assert.notEqual(row.from_id, BOT_CHANNEL_FROM_ID);
      assert.notEqual(row.from_id, null);
      assert.notEqual(row.text, '');
      seen.add(row.msg_id);
    }
    assert.equal(seen.size, 8, `пул топ-цитат фикстуры: ${[...seen].join(',')}`);
    const exhausted = s.bot.randomTopQuote(CHAT, BOT_TOPIC_ID, {
      minReactions: 3,
      excludeFromId: BOT_CHANNEL_FROM_ID,
      avoidMsgIds: [...seen],
    });
    assert.equal(exhausted, null, 'avoidMsgIds вычитает уже показанные цитаты');

    // randomAuthorQuote: только указанный автор, fallback на реакции ≥1
    const byAuthor = s.bot.randomAuthorQuote(CHAT, BOT_TOPIC_ID, '100', 3);
    assert.ok(byAuthor, 'у Saveliy есть цитаты с реакциями');
    assert.equal(byAuthor?.from_id, '100');
    const anyReaction = s.bot.randomAuthorQuote(CHAT, BOT_TOPIC_ID, '100', 99);
    assert.ok(anyReaction, 'fallback: без порога реакций цитата всё равно находится');
    assert.equal(s.bot.randomAuthorQuote(CHAT, BOT_TOPIC_ID, '999999', 1), null);

    // randomGameQuote: 40–400 зн., реакции ≥5, живой участник
    for (let i = 0; i < 5; i++) {
      const row = s.bot.randomGameQuote(CHAT, BOT_TOPIC_ID, {
        excludeFromId: BOT_CHANNEL_FROM_ID,
      });
      assert.ok(row, 'кандидат для игры найден');
      if (!row) break;
      assert.ok(row.text.length >= 40 && row.text.length <= 400);
      assert.ok(row.reaction_total >= 5);
      assert.notEqual(row.from_id, BOT_CHANNEL_FROM_ID);
    }
    assert.equal(
      s.bot.randomGameQuote(CHAT, BOT_TOPIC_ID, { excludeFromId: BOT_CHANNEL_FROM_ID, minLen: 400, maxLen: 500 }),
      null,
      'слишком узкие границы длины → честный null',
    );

    // курсор FTS и батчи
    assert.deepEqual(
      s.bot.iterMessagesAfter(CHAT, BOT_TOPIC_ID, 190, 10).map((r) => r.msg_id),
      [200],
    );
    assert.equal(s.bot.iterMessagesAfter(CHAT, BOT_TOPIC_ID, 0, 5).length, 5);

    // join по PK
    const rows = s.bot.getMessagesByKeys(CHAT, [
      { topicId: BOT_TOPIC_ID, msgId: 10 },
      { topicId: BOT_TOPIC_ID, msgId: 999 },
    ]);
    assert.equal(rows.size, 1);
    assert.ok(rows.has(`${BOT_TOPIC_ID}:10`));
  } finally {
    s.close();
  }
});

test('BotStore: randomAuthorGameQuote (40–400/реакции/no-http/avoid) и sampleAuthorDate', () => {
  const s = makeStores();
  try {
    s.tg.upsertMessages(makeRows(20));
    // автор 100: единственный кандидат в игровом пуле — «парковочная» строка msg 200
    const row = s.bot.randomAuthorGameQuote(CHAT, BOT_TOPIC_ID, '100');
    assert.ok(row, 'игровая цитата автора найдена');
    assert.equal(row?.msg_id, 200);
    assert.ok(row!.text.length >= 40 && row!.text.length <= 400);
    assert.ok(!row!.text.includes('http'));
    assert.equal(
      s.bot.randomAuthorGameQuote(CHAT, BOT_TOPIC_ID, '100', { avoidMsgIds: [200] }),
      null,
      'avoid вычитает единственного кандидата дочерна',
    );
    assert.equal(s.bot.randomAuthorGameQuote(CHAT, BOT_TOPIC_ID, '999999'), null);

    // http-цитата и слишком короткая — не кандидаты, годная находится
    const extra: TgMessageRow[] = [
      {
        chat_id: CHAT,
        topic_id: BOT_TOPIC_ID,
        msg_id: 501,
        from_id: '400',
        from_name: 'Http Guy',
        text: 'гляньте https://example.com это очень длинная цитата про парковку и футбол',
        date_iso: '2024-05-05T10:00:00.000Z',
        reactions_json: '{}',
        reaction_total: 9,
      },
      {
        chat_id: CHAT,
        topic_id: BOT_TOPIC_ID,
        msg_id: 502,
        from_id: '400',
        from_name: 'Http Guy',
        text: 'коротыш',
        date_iso: '2024-05-06T10:00:00.000Z',
        reactions_json: '{}',
        reaction_total: 9,
      },
      {
        chat_id: CHAT,
        topic_id: BOT_TOPIC_ID,
        msg_id: 503,
        from_id: '400',
        from_name: 'Http Guy',
        text: 'нормальная цитата без ссылок про парковку у ТТК и возмутительную разметку',
        date_iso: '2024-05-07T10:00:00.000Z',
        reactions_json: '{}',
        reaction_total: 9,
      },
    ];
    s.tg.upsertMessages(extra);
    for (let i = 0; i < 10; i++) {
      const picked = s.bot.randomAuthorGameQuote(CHAT, BOT_TOPIC_ID, '400');
      assert.ok(picked);
      assert.equal(picked?.msg_id, 503, 'http и короче 40 зн. отфильтрованы');
    }

    // sampleAuthorDate: реальный date_iso автора; без текстовых → null
    const date = s.bot.sampleAuthorDate(CHAT, BOT_TOPIC_ID, '100');
    assert.ok(date, 'у автора с текстами дата находится');
    assert.match(date ?? '', /^2024-\d{2}-15T10:00:00/);
    assert.equal(s.bot.sampleAuthorDate(CHAT, BOT_TOPIC_ID, '888888'), null);
  } finally {
    s.close();
  }
});

test('FtsStore + catchUpFtsIndex: сборка, инкремент, поиск по автору и морфологии', () => {
  const s = makeStores();
  try {
    s.tg.upsertMessages(makeRows(15));
    const first = catchUpFtsIndex(s.bot, s.fts);
    assert.equal(first.added, 10, 'media-only (i%5==1) и NULL-авторы (i%7==0) не индексируются');
    assert.equal(first.maxId, 150);
    assert.equal(s.fts.countDocs(), 10);
    assert.equal(s.fts.getMaxIndexed(), 150);

    const second = catchUpFtsIndex(s.bot, s.fts);
    assert.equal(second.added, 0, 'инкремент без новых — пусто');

    s.tg.upsertMessages(makeRows(18));
    const third = catchUpFtsIndex(s.bot, s.fts);
    assert.equal(third.added, 2, 'доклеились только новые текстовые с атрибуцией');
    assert.equal(third.maxId, 180);

    // поиск: фильтр по from_id (атрибуция кодом, не LLM)
    const sevens = s.fts.search(CHAT, buildFtsQuery('парковка'), '200', 10);
    assert.equal(sevens.length, 1);
    assert.equal(sevens[0].fromId, '200');
    assert.equal(sevens[0].msgId, 50);
    const slava = s.fts.search(CHAT, buildFtsQuery('парковка'), '300', 10);
    assert.equal(slava.length, 1);
    const all = s.fts.search(CHAT, buildFtsQuery('парковка'), null, 10);
    assert.equal(all.length, 3, 'пост бот-канала тоже в индексе — фильтр по автору обязателен');

    // морфология префиксом: точный префикс чужой словоформы vs общий корень
    assert.equal(s.fts.search(CHAT, 'парковки*', '200', 10).length, 0, 'парковки* не матчит токен «парковка»');
    assert.equal(s.fts.search(CHAT, 'парковк*', '200', 10).length, 1, 'общий корень парковк* матчит');

    assert.equal(s.fts.search(CHAT, buildFtsQuery('квантовый'), '200', 10).length, 0);

    // «Полная пересборка» = сборка с нуля в чистый файл (как .build-путь rebuildFtsFull)
    const fresh = new FtsStore(join(s.dir, 'tg-fts-build.sqlite'), { disposable: true });
    assert.equal(catchUpFtsIndex(s.bot, fresh).added, 12, 'с нуля индексируются все 12 текстовых');
    assert.equal(fresh.countDocs(), 12);
    assert.equal(fresh.getMaxIndexed(), 180);
    fresh.close();
    rmSync(join(s.dir, 'tg-fts-build.sqlite'), { force: true });

    assert.ok(s.fts.fileSizeBytes() > 0);
  } finally {
    s.close();
  }
});

test('формат цитаты: дата ВСЕГДА в выводе (guardrail G2)', () => {
  const card = formatQuoteCard({
    from_name: 'Saveliy',
    text: 'Реальная цитата',
    date_iso: '2024-03-12T18:30:00.000Z',
  });
  assert.match(card, /^\[12\.03\.2024\] Saveliy:\nРеальная цитата$/);

  const cut = formatQuoteCard({ from_name: 'A', text: 'х'.repeat(700), date_iso: '2024-03-12T00:00:00Z' });
  assert.ok(cut.length < 700);
  assert.ok(cut.endsWith('…'));
  assert.match(cut, /^\[12\.03\.2024\] /, 'дата на месте и после обрезки');

  assert.equal(truncate('abcdef', 4), 'abcd…');
  assert.equal(truncate('abc', 4), 'abc');
  assert.equal(formatDate('2026-09-24T05:00:00Z'), '24.09.2026');
  assert.equal(formatDate('мусор'), 'мусор');
});

test('вопрос /игра: дата есть, автора нет (guardrail G2 + не спойлерим)', () => {
  const q = formatGameQuestion({ text: 'Реальная цитата раунда', date_iso: '2024-03-12T18:30:00.000Z' });
  assert.ok(q.startsWith('🎯 Кто это сказал?'));
  assert.match(q, /\[12\.03\.2024\]/, 'дата обязана быть в вопросе');
  assert.ok(q.includes('«Реальная цитата раунда»'));
  assert.ok(!q.includes('Saveliy'), 'имя автора в вопросе не раскрывается');

  const long = 'х'.repeat(500);
  const cut = formatGameQuestion({ text: long, date_iso: '2024-03-12T00:00:00Z' });
  assert.ok(cut.length < 600, 'цитата в вопросе усечена');
  assert.ok(cut.endsWith('…»\n\n⏱ 90 секунд'));
});
