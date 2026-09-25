import test from 'node:test';
import assert from 'node:assert/strict';
import { FactchempikBot } from './bot.js';
import { OutboxQueue, CooldownLimiter } from './botQueue.js';
import type { OutboundMessage } from './botQueue.js';
import type { TgCallbackQuery, TgUpdate } from './botApi.js';
import type { ImprovGame } from './botImprov.js';
import type { AuthorEntry } from './botNames.js';

const CHAT = '-1001736860345';

const DIRECTORY: AuthorEntry[] = [
  {
    fromId: '100',
    name: 'Saveliy',
    messages: 100,
    textMessages: 90,
    firstDate: '2022-03-23T00:00:00.000Z',
    lastDate: '2026-09-18T00:00:00.000Z',
  },
];

interface BotHarness {
  bot: FactchempikBot;
  sent: OutboundMessage[];
  deleted: number[];
  edits: Array<{ chatId: string; msgId: number; text: string }>;
  session: { startedAt: number; updatesSeen: number; enabled: boolean };
  announceId(): number;
}

function makeBot(opts: { enabled?: boolean } = {}): BotHarness {
  const sent: OutboundMessage[] = [];
  const deleted: number[] = [];
  const edits: Array<{ chatId: string; msgId: number; text: string }> = [];
  const queue = new OutboxQueue({
    sender: async (m) => {
      sent.push(m);
      return 100 + sent.length;
    },
    gapMs: 1,
    sleep: async () => {},
  });
  const session = { startedAt: 0, updatesSeen: 0, enabled: opts.enabled ?? true };
  const deps = {
    api: {
      sendMessage: async () => 1,
      deleteMessage: async (_chatId: string, messageId: number) => {
        deleted.push(messageId);
        return true;
      },
      editMessageText: async (chatId: string, messageId: number, text: string) => {
        edits.push({ chatId, msgId: messageId, text });
        return true;
      },
      answerCallbackQuery: async () => true,
    },
    store: {
      setState: () => {},
      getState: () => null,
      randomAuthorGameQuote: () => null,
      sampleAuthorDate: () => null,
      getMessagesByKeys: () => new Map(),
    },
    fts: {},
    queue,
    cooldown: new CooldownLimiter(),
    directory: { get: () => DIRECTORY },
    cfg: { allowChats: new Set([CHAT]), ownerChatId: null, pollTimeoutSec: 5, botToken: 'токен' },
    session,
    botId: '999',
  } as unknown as ConstructorParameters<typeof FactchempikBot>[0];
  const bot = new FactchempikBot(deps);
  return {
    bot,
    sent,
    deleted,
    edits,
    session,
    announceId: () => 100 + sent.length,
  };
}

function improvOf(h: BotHarness): ImprovGame {
  return (h.bot as unknown as { improv: ImprovGame }).improv;
}

function ctx(chatId = CHAT): { chatId: string; userId: string; userName: string; replyTo: number; isOwner: boolean } {
  return { chatId, userId: 'u1', userName: 'Юзер', replyTo: 5, isOwner: true };
}

/** Раунд /игра без живого таймера — для проверок слота и ревила. */
function stubTimer(): NodeJS.Timeout {
  return setTimeout(() => {}, 30);
}

function messageUpdate(
  messageId: number,
  replyTo?: number,
  text = 'Пародия на манеру автора',
  userId = 42,
): TgUpdate {
  return {
    update_id: messageId,
    message: {
      message_id: messageId,
      chat: { id: Number(CHAT), type: 'supergroup' },
      from: { id: userId, first_name: `Юзер${userId}`, is_bot: false },
      text,
      ...(replyTo !== undefined ? { reply_to_message: { message_id: replyTo } } : {}),
    },
  };
}

async function startImprovRound(h: BotHarness): Promise<void> {
  await improvOf(h).start({
    chatId: CHAT,
    author: DIRECTORY[0],
    theme: '',
    real: {
      msgId: 1,
      text: 'Настоящая цитата автора про футбол и парковку',
      dateIso: '2023-07-11T00:00:00.000Z',
      reactions: 10,
    },
  });
}

test('фикс D7: revealRound при выключенном боте молча снимает раунд, без поста', async () => {
  const h = makeBot({ enabled: false });
  try {
    (h.bot as unknown as { rounds: Map<string, unknown> }).rounds.set(CHAT, {
      seq: 1,
      chatId: CHAT,
      correctFromId: '100',
      options: [],
      quoteText: 'цитата',
      quoteDate: '2024-01-01T00:00:00.000Z',
      quoteReactions: 3,
      endsAt: Date.now() + 1000,
      timer: stubTimer(),
      finished: false,
    });
    await (h.bot as unknown as { revealRound(c: string, t: boolean): Promise<void> }).revealRound(CHAT, true);
    assert.equal(h.sent.length, 0, 'после /off ревил не публикуется');
    assert.equal((h.bot as unknown as { rounds: Map<string, unknown> }).rounds.has(CHAT), false, 'раунд снят');
  } finally {
    h.bot.cancelTimers();
  }
});

test('revealRound при включённом боте работает как раньше (контроль D7)', async () => {
  const h = makeBot();
  try {
    (h.bot as unknown as { rounds: Map<string, unknown> }).rounds.set(CHAT, {
      seq: 1,
      chatId: CHAT,
      correctFromId: '100',
      options: [],
      quoteText: 'цитата',
      quoteDate: '2024-01-01T00:00:00.000Z',
      quoteReactions: 3,
      endsAt: Date.now() + 1000,
      timer: stubTimer(),
      finished: false,
    });
    await (h.bot as unknown as { revealRound(c: string, t: boolean): Promise<void> }).revealRound(CHAT, true);
    assert.equal(h.sent.length, 1);
    assert.match(h.sent[0].text, /⏰ Время вышло!/);
    assert.match(h.sent[0].text, /Saveliy · \[01\.01\.2024\]/);
  } finally {
    h.bot.cancelTimers();
  }
});

test('взаимоисключение: раунд «изобрази» блокирует /игра и наоборот', async () => {
  const h = makeBot();
  try {
    await startImprovRound(h);
    await (h.bot as unknown as { cmdGame(c: unknown): Promise<void> }).cmdGame(ctx());
    assert.match(h.sent.at(-1)!.text, /Раунд уже идёт/);
    h.bot.cancelTimers();

    (h.bot as unknown as { rounds: Map<string, unknown> }).rounds.set(CHAT, {
      finished: false,
      endsAt: Date.now() + 20_000,
      timer: stubTimer(),
    });
    h.sent.length = 0;
    await (h.bot as unknown as { cmdImprov(a: string, c: unknown): Promise<void> }).cmdImprov('saveliy парковка', ctx());
    assert.match(h.sent.at(-1)!.text, /Раунд уже идёт/);
  } finally {
    h.bot.cancelTimers();
  }
});

test('MAJOR-фикс: кнопка дизамбиги (res:) при активной /игра → отказ, раунд не стартует', async () => {
  const h = makeBot();
  try {
    (h.bot as unknown as { rounds: Map<string, unknown> }).rounds.set(CHAT, {
      finished: false,
      endsAt: Date.now() + 20_000,
      timer: stubTimer(),
    });
    const token = 'tok12345';
    (h.bot as unknown as { pending: Map<string, unknown> }).pending.set(token, {
      chatId: CHAT,
      cmdName: 'изобрази',
      argsText: '',
      replyTo: 5,
      expiresAt: Date.now() + 60_000,
    });
    const cb: TgCallbackQuery = {
      id: 'cbz',
      from: { id: 42, first_name: 'Юзер' },
      message: {
        message_id: 1,
        chat: { id: Number(CHAT), type: 'supergroup' },
        from: { id: 42, first_name: 'Юзер', is_bot: false },
      },
      data: `res:${token}:100`,
    };
    await (h.bot as unknown as { handleCallback(cb: TgCallbackQuery): Promise<void> }).handleCallback(cb);
    assert.match(h.sent.at(-1)!.text, /Раунд уже идёт/, 'гард в cmdImprovStart сработал');
    assert.equal(improvOf(h).hasActiveRound(CHAT), null, 'второй раунд не стартовал');
  } finally {
    h.bot.cancelTimers();
  }
});

test('reply-ветка: реплай на анонс «Изобрази» становится записью и удаляется', async () => {
  const h = makeBot();
  try {
    await startImprovRound(h);
    const announce = h.announceId();
    await h.bot.handleUpdate(messageUpdate(500, announce));
    assert.deepEqual(h.deleted, [500], 'запись принята и скрыта');
    assert.ok(h.edits.some((e) => e.text.includes('✍️ Принято: 1/3')), 'счётчик отредактирован');
    await h.bot.handleUpdate(messageUpdate(501, announce + 5));
    assert.deepEqual(h.deleted, [500], 'реплай на чужую карточку бота — молча');
  } finally {
    h.bot.cancelTimers();
  }
});

test('общий счёт: очки /игра видны в ревиле «изобрази»', async () => {
  const h = makeBot();
  try {
    (h.bot as unknown as { addScore(c: string, u: string, n: string, d: number): void }).addScore(
      CHAT,
      'u1',
      'Знаток',
      2,
    );
    await startImprovRound(h);
    const announce = h.announceId();
    await h.bot.handleUpdate(messageUpdate(500, announce, undefined, 42));
    await h.bot.handleUpdate(messageUpdate(501, announce, 'Пародия первая, но не настоящая', 43));
    await h.bot.handleUpdate(messageUpdate(502, announce, 'Пародия вторая, тоже не настоящая', 44));
    assert.ok(
      h.edits.some((e) => e.text.includes('✍️ Принято: 3/3')),
      'все три записи приняты (минимальное окно держит набор открытым)',
    );
    // окно 45 с нарочно коротким не делаем — закрываем набор вручную (как таймер)
    const game = improvOf(h);
    await (game as unknown as { closeCollect(c: string): void }).closeCollect(CHAT);
    const token = (game as unknown as { rounds: Map<string, { token: string }> }).rounds.get(CHAT)?.token ?? '';
    assert.ok(token, 'раунд «изобрази» жив');
    await game.handleVote('cb1', CHAT, 'v1', 'Голос', token, '1');
    await game.handleVote('cb2', CHAT, 'v2', 'Голос', token, '2');
    await game.handleVote('cb3', CHAT, 'v3', 'Голос', token, '3');
    await (game as unknown as { reveal(c: string): Promise<void> }).reveal(CHAT);
    assert.match(h.sent.at(-1)!.text, /🏆 Сессия: .*Знаток — 2/, 'доска общая: очки /игра в топе');
    assert.equal(game.hasActiveRound(CHAT), null, 'раунд завершён');
  } finally {
    h.bot.cancelTimers();
  }
});

test('/off гасит оба слота: активный /игра — с постом, «изобрази» — через cancelActive', async () => {
  const h = makeBot();
  try {
    (h.bot as unknown as { rounds: Map<string, unknown> }).rounds.set(CHAT, {
      finished: false,
      endsAt: Date.now() + 20_000,
      timer: stubTimer(),
    });
    await (h.bot as unknown as { cmdSetEnabled(e: boolean, c: unknown): Promise<void> }).cmdSetEnabled(false, ctx());
    assert.equal(h.session.enabled, false);
    assert.ok(h.sent.some((m) => m.text.includes('🛑 Раунд прерван владельцем')));
    assert.equal((h.bot as unknown as { rounds: Map<string, unknown> }).rounds.has(CHAT), false);

    h.session.enabled = true;
    await startImprovRound(h);
    h.sent.length = 0;
    await (h.bot as unknown as { cmdSetEnabled(e: boolean, c: unknown): Promise<void> }).cmdSetEnabled(false, ctx());
    assert.ok(h.sent.some((m) => m.text.includes('🛑 Раунд прерван владельцем')));
    assert.equal(improvOf(h).hasActiveRound(CHAT), null, 'слот «изобрази» свободен');
  } finally {
    h.bot.cancelTimers();
  }
});
