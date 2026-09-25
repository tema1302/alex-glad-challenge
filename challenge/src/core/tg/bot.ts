// Бот «Фактчемпик» (M1) — память и шаржист чата «Факты в чате».
// Спек: prompts/factchempik-bot.md; решения консилиума: swarm-report/factchempik-plan-01.md.
//
// Железная граница: реальные цитаты — только SQL/FTS по tg.sqlite, атрибуция по
// from_id КОДОМ, дата в выводе всегда; воображаемое (M3) — только через 🎭-маркер
// (гейт в jokerMarker.ts). Сеть — Bot API через netFetch (botApi.ts). Логи —
// только метаданные (chat_id/msg_id/счётчики), тексты сообщений не логируются.
// Исходящие из БД данные — только в чаты из allow-list (fail-closed).

import { rmSync, renameSync } from 'node:fs';
import { getTgBotRuntimeConfig } from '../env.js';
import { dataPath } from '../paths.js';
import { BotApiClient, BotApiError } from './botApi.js';
import type { TgUpdate, TgCallbackQuery, TgUser } from './botApi.js';
import { BotStore } from './botStore.js';
import { FtsStore } from './ftsStore.js';
import { buildFtsQuery, scoreQuote, themeFromReplyText } from './botFtsQuery.js';
import { resolveAuthor, resolveGreedyName } from './botNames.js';
import type { AuthorEntry, ResolveResult } from './botNames.js';
import { extractInvocation } from './botCommands.js';
import type { ParsedCommand } from './botCommands.js';
import { OutboxQueue, SendError, CooldownLimiter, errText } from './botQueue.js';
import type { OutboundMessage } from './botQueue.js';
import { ImprovGame } from './botImprov.js';

// Целевой чат фичи (t.me/lookAtFactsChat). Бот отвечает в любом чате из
// allow-list, но данные (цитаты/игра) — всегда из этого чата.
export const BOT_CHAT_KEY = '-1001736860345';
export const BOT_TOPIC_ID = 0;
// Бот-канал «Иди на факты глянь» — НЕ участник: исключён из цитат/игры/каталога.
export const BOT_CHANNEL_FROM_ID = '-1001298193122';

// SEED алиасов (проверены lookup по tg.sqlite 2026-09-24). «вячеслав» НЕ сажаем:
// подстрока матчит 9 from_id — это кейс дизамбиг-кнопок, а не словаря.
const SEED_ALIASES: Readonly<Record<string, string>> = {
  'савелий': '662123302',
  'saveliy': '662123302',
  'sevens': '587493810',
  'севенс': '587493810',
  'краснобелый': '1321375335',
  'краснобелий': '1321375335',
};

const GAME_ROUND_MS = 90_000;
const RESOLVE_TTL_MS = 60_000;
const COOLDOWN_HINT = 'Прилег чуть-чуть: не больше 3 команд в минуту.';

export interface RunTgBotOpts {
  /** Собрать/доклеить FTS-индекс и выйти (без сети). */
  indexOnly?: boolean;
  /** Полная перестройка FTS (иначе инкрементальный догон). */
  rebuildIndex?: boolean;
}

export async function runTgBot(opts: RunTgBotOpts = {}): Promise<void> {
  const cfg = getTgBotRuntimeConfig();
  if (!cfg) {
    console.error('tg-bot: TG_BOT_TOKEN не задан (см. .env.example).');
    process.exit(1);
  }
  if (cfg.allowChats.size === 0) {
    console.error(
      'tg-bot: TG_BOT_ALLOW_CHATS пуст — бот НЕ работает (fail-closed). ' +
        'Добавь в .env строку вида TG_BOT_ALLOW_CHATS=-1001736860345.',
    );
    process.exit(1);
  }
  console.error(
    `[tg-bot] allow-list: ${cfg.allowChats.size} чат(ов); owner: ` +
      (cfg.ownerChatId ? 'задан' : 'НЕ задан (админ-команды недоступны)'),
  );

  const store = new BotStore(dataPath('tg.sqlite'));
  const fts = new FtsHolder(dataPath('tg-fts.sqlite'));
  const seeded = store.ensureSeedAliases(SEED_ALIASES);
  if (seeded > 0) console.error(`[tg-bot] seed-алиасов добавлено: ${seeded}`);

  if (opts.rebuildIndex) {
    console.error('[tg-bot] FTS: полная перестройка в свежий файл…');
    const r = rebuildFtsFull(store, fts);
    console.error(`[tg-bot] FTS: пересобрано ${r.added} док. за ${(r.ms / 1000).toFixed(1)} с`);
  } else {
    fts.discardBuildArtifacts();
    fts.open();
  }
  const idx = catchUpFtsIndex(store, fts.get());
  console.error(
    `[tg-bot] FTS: +${idx.added} док. за ${(idx.ms / 1000).toFixed(1)} с; ` +
      `всего ${fts.get().countDocs()}, курсор msg_id=${idx.maxId}, ` +
      `файл ${(fts.get().fileSizeBytes() / 1024 / 1024).toFixed(1)} МБ`,
  );
  if (opts.indexOnly) {
    store.close();
    fts.close();
    return;
  }

  const api = new BotApiClient(cfg.botToken);
  let me: TgUser;
  try {
    me = await api.getMe();
  } catch (err) {
    console.error(`tg-bot: getMe не прошёл — ${errText(err)}`);
    store.close();
    fts.close();
    process.exit(1);
  }
  console.error(`[tg-bot] бот: @${me.username ?? String(me.id)}`);
  try {
    await api.deleteWebhook();
  } catch (err) {
    console.error(`[tg-bot] deleteWebhook (не фатально): ${errText(err)}`);
  }
// Меню команд (setMyCommands) не регистрируем: Bot API принимает только [a-z0-9_]{1,32},
// команды M1 кириллические по спеку — вызов падал BOT_COMMAND_INVALID на каждом старте.
// Парсер читает текст сообщения, команды работают при ручном вводе.

  const queue = new OutboxQueue({
    sender: async (m) => {
      try {
        return await api.sendMessage(m.chatId, m.text, { replyTo: m.replyTo, markup: m.markup });
      } catch (err) {
        if (err instanceof BotApiError) throw new SendError(err.message, err.retryAfterSec);
        throw err;
      }
    },
    onError: (msg) => console.error(`[tg-bot][queue] ${msg}`),
  });

  const session = { startedAt: Date.now(), updatesSeen: 0, enabled: store.getState('enabled') !== '0' };
  const bot = new FactchempikBot({
    api,
    store,
    fts,
    queue,
    cooldown: new CooldownLimiter(),
    directory: new AuthorDirectory(store),
    cfg,
    session,
    botId: String(me.id),
    botUsername: me.username,
  });

  let offset = Number(store.getState('poll_offset') ?? '0') || 0;
  const seen = new Set<number>();
  let backoffMs = 0;
  let shuttingDown = false;
  const abort = new AbortController();
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error('[tg-bot] SIGINT/SIGTERM — завершаюсь: drain очереди, persist offset…');
    abort.abort();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  while (!shuttingDown) {
    let updates: TgUpdate[];
    try {
      updates = await api.getUpdates(offset, cfg.pollTimeoutSec, ['message', 'callback_query'], abort.signal);
    } catch (err) {
      if (shuttingDown || abort.signal.aborted) break;
      if (err instanceof BotApiError && err.code === 409) {
        console.error('tg-bot: 409 Conflict — токен уже используется (второй инстанс или webhook). Выхожу.');
        store.close();
        fts.close();
        process.exit(1);
      }
      // Сетевой сбой → backoff ×2 (cap 30 с), НЕ exit (спек §2).
      backoffMs = backoffMs === 0 ? 1000 : Math.min(backoffMs * 2, 30_000);
      console.error(`[tg-bot] poll error (${errText(err)}); пауза ${backoffMs} мс`);
      await sleepAbortable(backoffMs, abort.signal);
      continue;
    }
    backoffMs = 0;
    for (const u of updates) {
      if (seen.has(u.update_id)) {
        offset = u.update_id + 1;
        continue;
      }
      seen.add(u.update_id);
      if (seen.size > 20_000) seen.clear();
      session.updatesSeen++;
      try {
        await bot.handleUpdate(u);
      } catch (err) {
        console.error(`[tg-bot] handler error (update_id=${u.update_id}): ${errText(err)}`);
      }
      offset = u.update_id + 1;
      store.setState('poll_offset', String(offset));
    }
  }

  bot.cancelTimers();
  await Promise.race([queue.drain(), sleepAbortable(5_000, abort.signal)]);
  store.setState('poll_offset', String(offset));
  store.close();
  fts.close();
  console.error('[tg-bot] остановлен.');
  process.exit(0);
}

interface FactchempikDeps {
  api: BotApiClient;
  store: BotStore;
  fts: FtsHolder;
  queue: OutboxQueue;
  cooldown: CooldownLimiter;
  directory: AuthorDirectory;
  cfg: NonNullable<ReturnType<typeof getTgBotRuntimeConfig>>;
  session: { startedAt: number; updatesSeen: number; enabled: boolean };
  botId: string;
  botUsername?: string;
}

interface CommandCtx {
  chatId: string;
  userId: string;
  userName: string;
  replyTo: number;
  replyText?: string;
  isOwner: boolean;
}

interface PendingResolve {
  chatId: string;
  cmdName: 'цитата' | 'сказал' | 'изобрази';
  argsText: string;
  replyTo: number;
  replyText?: string;
  expiresAt: number;
}

interface GameRound {
  seq: number;
  chatId: string;
  correctFromId: string;
  options: Array<{ fromId: string; label: string }>;
  quoteText: string;
  quoteDate: string;
  quoteReactions: number;
  endsAt: number;
  timer: NodeJS.Timeout;
  finished: boolean;
}

export class FactchempikBot {
  private readonly pending = new Map<string, PendingResolve>();
  private readonly rounds = new Map<string, GameRound>();
  private readonly scores = new Map<string, Map<string, { name: string; score: number }>>();
  private readonly lastQuotes = new Map<string, number[]>();
  private readonly improv: ImprovGame;
  private roundSeq = 0;

  constructor(private readonly d: FactchempikDeps) {
    this.improv = new ImprovGame({
      send: (m) => d.queue.enqueue(m),
      del: (chatId, msgId) => d.api.deleteMessage(chatId, msgId),
      edit: (chatId, msgId, text, markup) => d.api.editMessageText(chatId, msgId, text, { markup }),
      answer: (cbId, text) => this.safeAnswer(cbId, text),
      plausibleDate: (fromId) => d.store.sampleAuthorDate(BOT_CHAT_KEY, BOT_TOPIC_ID, fromId),
      addScore: (chatId, userId, name, delta) => this.addScore(chatId, userId, name, delta),
      topScores: (chatId) => this.topScoresLine(chatId),
      now: () => Date.now(),
      log: (msg) => console.error(`[tg-bot][improv] ${msg}`),
    });
  }

  cancelTimers(): void {
    for (const r of this.rounds.values()) clearTimeout(r.timer);
    this.rounds.clear();
    this.improv.cancelAllSilent();
  }

  async handleUpdate(u: TgUpdate): Promise<void> {
    if (u.callback_query) {
      await this.handleCallback(u.callback_query);
      return;
    }
    const msg = u.message;
    if (!msg || !msg.from) return;
    const chatId = String(msg.chat.id);
    const userId = String(msg.from.id);
    if (msg.from.is_bot || userId === this.d.botId) return;

    const isPrivate = msg.chat.type === 'private';
    const isOwner = this.isOwner(userId);
    if (isPrivate ? !isOwner : !this.d.cfg.allowChats.has(chatId)) return;
    if (!this.d.session.enabled && !isOwner) return;

    // Реплай на анонс «Изобрази» — всегда запись (даже если текст начинается с «/»);
    // жёсткое сравнение message_id отсекает реплаи на другие карточки бота.
    if (msg.reply_to_message && this.improv.isCollectAnnounce(chatId, msg.reply_to_message.message_id)) {
      try {
        await this.improv.handleEntry({
          chatId,
          msgId: msg.message_id,
          userId,
          userName: msg.from.first_name ?? msg.from.username ?? 'участник',
          replyToMessageId: msg.reply_to_message.message_id,
          text: msg.text,
        });
      } catch (err) {
        console.error(`[tg-bot] improv entry (chat=${chatId} user=${userId}): ${errText(err)}`);
      }
      return;
    }

    const cmd = extractInvocation(msg.text ?? msg.caption, this.d.botUsername);
    if (!cmd) return;

    if (!isOwner) {
      const cd = this.d.cooldown.check(userId, Date.now());
      if (!cd.allowed) {
        if (cd.hint) await this.reply(chatId, COOLDOWN_HINT, msg.message_id);
        return;
      }
    }

    const ctx: CommandCtx = {
      chatId,
      userId,
      userName: msg.from.first_name ?? msg.from.username ?? 'участник',
      replyTo: msg.message_id,
      replyText: msg.reply_to_message?.text,
      isOwner,
    };
    try {
      await this.dispatch(cmd, ctx);
    } catch (err) {
      console.error(`[tg-bot] команда /${cmd.name} упала (chat=${chatId} user=${userId}): ${errText(err)}`);
      await this.reply(chatId, '⚠️ Внутренняя ошибка, попробуй ещё раз.', ctx.replyTo);
    }
  }

  // --- dispatch ---

  private async dispatch(cmd: ParsedCommand, ctx: CommandCtx): Promise<void> {
    switch (cmd.name) {
      case 'цитата':
        return this.cmdQuote(cmd.args, ctx);
      case 'сказал':
        return this.cmdSaid(cmd.args, ctx);
      case 'игра':
        return this.cmdGame(ctx);
      case 'изобрази':
        return this.cmdImprov(cmd.args, ctx);
      case 'какбы':
        return this.reply(
          ctx.chatId,
          '🎭-стилизация (/какбы) появится позже — пока умею /цитата, /сказал, /игра, /изобрази.',
          ctx.replyTo,
        );
      default:
        break;
    }
    if (!ctx.isOwner) return; // админ-команды — только owner, остальным молчание
    switch (cmd.name) {
      case 'reindex':
        return this.cmdReindex(ctx);
      case 'алиас':
        return this.cmdAlias(cmd.args, ctx);
      case 'off':
        return this.cmdSetEnabled(false, ctx);
      case 'on':
        return this.cmdSetEnabled(true, ctx);
      case 'стат':
        return this.cmdStat(ctx);
      default:
        return;
    }
  }

  private async cmdQuote(args: string, ctx: CommandCtx): Promise<void> {
    const store = this.d.store;
    if (!args) {
      const avoid = this.lastQuotes.get(ctx.chatId) ?? [];
      const row = store.randomTopQuote(BOT_CHAT_KEY, BOT_TOPIC_ID, {
        minReactions: 3,
        excludeFromId: BOT_CHANNEL_FROM_ID,
        avoidMsgIds: avoid,
      });
      if (!row) {
        await this.reply(ctx.chatId, 'Топ-цитаты кончились (или база пуста).', ctx.replyTo);
        return;
      }
      this.rememberQuote(ctx.chatId, row.msg_id);
      await this.reply(ctx.chatId, formatQuoteCard(row), ctx.replyTo);
      return;
    }
    // Имя может быть многословным: сначала аргумент целиком, потом первый токен.
    const whole = this.resolveOnce(args);
    const r = whole.kind !== 'none' ? whole : this.resolveOnce(args.split(/\s+/)[0]);
    await this.runResolved(r, args, ctx, 'цитата', '');
  }

  private async cmdSaid(args: string, ctx: CommandCtx): Promise<void> {
    const words = args.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      await this.reply(
        ctx.chatId,
        'Формат: /сказал <имя> [тема…] — или реплай на сообщение бота.',
        ctx.replyTo,
      );
      return;
    }
    const { name: nameCandidate, themeWords, result: nameResult } = resolveGreedyName(words, (q) =>
      this.resolveOnce(q),
    );
    let theme = themeWords.join(' ');
    if (!theme && ctx.replyText) theme = themeFromReplyText(ctx.replyText);
    if (!theme) {
      await this.reply(
        ctx.chatId,
        'Про что искать? Добавь тему: /сказал <имя> <тема…> (или реплай на сообщение).',
        ctx.replyTo,
      );
      return;
    }
    const matchQuery = buildFtsQuery(theme);
    if (!matchQuery) {
      await this.reply(ctx.chatId, 'В теме одни стоп-слова. Конкретизируй.', ctx.replyTo);
      return;
    }
    if (nameResult.kind === 'ok') {
      await this.sendSaidQuotes(nameResult.author, theme, matchQuery, ctx);
      return;
    }
    await this.runResolved(nameResult, nameCandidate, ctx, 'сказал', theme);
  }

  private resolveOnce(query: string): ResolveResult {
    return resolveAuthor(query, this.d.directory.get(), this.d.store.listAliases());
  }

  /** ambiguous → inline-кнопки (60 с); none → отказ с 3 подсказками. */
  private async runResolved(
    r: ResolveResult,
    query: string,
    ctx: CommandCtx,
    cmdName: 'цитата' | 'сказал' | 'изобрази',
    argsText: string,
  ): Promise<void> {
    if (r.kind === 'ok') {
      if (cmdName === 'сказал') await this.sendSaidQuotes(r.author, argsText, buildFtsQuery(argsText), ctx);
      else if (cmdName === 'изобрази') await this.cmdImprovStart(r.author, argsText, ctx);
      else await this.sendAuthorQuote(r.author, ctx);
      return;
    }
    if (r.kind === 'ambiguous') {
      this.sweepPending();
      const token = Math.random().toString(36).slice(2, 10);
      this.pending.set(token, {
        chatId: ctx.chatId,
        cmdName,
        argsText,
        replyTo: ctx.replyTo,
        replyText: ctx.replyText,
        expiresAt: Date.now() + RESOLVE_TTL_MS,
      });
      const buttons = r.options.slice(0, 8).map((o) => ({
        text: `${truncate(o.name, 20)} · ${o.textMessages} сообщ. · ${o.firstDate.slice(0, 4)}–${o.lastDate.slice(0, 4)}`,
        callback_data: `res:${token}:${o.fromId}`,
      }));
      await this.send({
        chatId: ctx.chatId,
        text: `«${query}» — уточни, кто именно:`,
        replyTo: ctx.replyTo,
        markup: { inline_keyboard: [buttons] },
      });
      return;
    }
    const names = r.suggestions.map((s) => s.name).join(', ');
    await this.reply(
      ctx.chatId,
      `Не знаю автора «${query}».${names ? ` Ближайшие: ${names}.` : ''}`,
      ctx.replyTo,
    );
  }

  private async sendAuthorQuote(author: AuthorEntry, ctx: CommandCtx): Promise<void> {
    const avoid = this.lastQuotes.get(ctx.chatId) ?? [];
    const row = this.d.store.randomAuthorQuote(BOT_CHAT_KEY, BOT_TOPIC_ID, author.fromId, 3, avoid);
    if (!row) {
      await this.reply(
        ctx.chatId,
        `У ${author.name} пока нет цитат в топе. Попробуй /сказал ${author.name} <тема>.`,
        ctx.replyTo,
      );
      return;
    }
    this.rememberQuote(ctx.chatId, row.msg_id);
    await this.reply(ctx.chatId, formatQuoteCard(row), ctx.replyTo);
  }

  private async sendSaidQuotes(
    author: AuthorEntry,
    theme: string,
    matchQuery: string,
    ctx: CommandCtx,
  ): Promise<void> {
    if (!matchQuery) {
      await this.reply(ctx.chatId, 'В теме одни стоп-слова. Конкретизируй.', ctx.replyTo);
      return;
    }
    let hits;
    try {
      hits = this.d.fts.get().search(BOT_CHAT_KEY, matchQuery, author.fromId, 200);
    } catch {
      await this.reply(ctx.chatId, 'Не смог разобрать тему, попробуй другими словами.', ctx.replyTo);
      return;
    }
    if (hits.length === 0) {
      await this.reply(ctx.chatId, `Про «${theme}» ${author.name} молчал.`, ctx.replyTo);
      return;
    }
    const rows = this.d.store.getMessagesByKeys(
      BOT_CHAT_KEY,
      hits.map((h) => ({ topicId: h.topicId, msgId: h.msgId })),
    );
    const now = Date.now();
    const scored = [...rows.values()]
      .map((row) => ({ row, score: scoreQuote(row.reaction_total, row.date_iso, now) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    const items = scored
      .map((s, i) => `${i + 1}. [${formatDate(s.row.date_iso)}] ${truncate(s.row.text, 500)}`)
      .join('\n');
    const header = `💬 ${author.name} про «${theme}»:\n\n`;
    const footer = scored.length > 1 ? `\n\n(${scored.length} из ${hits.length} найденных)` : '';
    await this.reply(ctx.chatId, header + items + footer, ctx.replyTo);
  }

  // --- игры (общий слот «один раунд на чат» на /игра и /изобрази) ---

  /** Когда освободится слот раунда любой игры; null — слот свободен. */
  private activeGameEndsAt(chatId: string): number | null {
    const game = this.rounds.get(chatId);
    if (game && !game.finished) return game.endsAt;
    const improv = this.improv.hasActiveRound(chatId);
    if (improv) return improv.endsAt;
    return null;
  }

  private async cmdGame(ctx: CommandCtx): Promise<void> {
    const activeEnds = this.activeGameEndsAt(ctx.chatId);
    if (activeEnds !== null) {
      const sec = Math.max(1, Math.round((activeEnds - Date.now()) / 1000));
      await this.reply(ctx.chatId, `Раунд уже идёт, осталось ${sec} с.`, ctx.replyTo);
      return;
    }
    const avoid = this.lastQuotes.get(ctx.chatId) ?? [];
    const quote = this.d.store.randomGameQuote(BOT_CHAT_KEY, BOT_TOPIC_ID, {
      excludeFromId: BOT_CHANNEL_FROM_ID,
      avoidMsgIds: avoid,
    });
    if (!quote || !quote.from_id) {
      await this.reply(ctx.chatId, 'Не нашёл цитату для раунда (база пуста?).', ctx.replyTo);
      return;
    }
    const distractors = this.d.directory
      .get()
      .filter((e) => e.fromId !== quote.from_id && e.textMessages > 20)
      .sort((a, b) => b.textMessages - a.textMessages)
      .slice(0, 15)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);
    if (distractors.length < 3) {
      await this.reply(ctx.chatId, 'Мало известных авторов для вариантов — попробуй позже.', ctx.replyTo);
      return;
    }
    const options = [
      { fromId: quote.from_id, label: truncate(quote.from_name, 24) },
      ...distractors.map((e) => ({ fromId: e.fromId, label: truncate(e.name, 24) })),
    ].sort(() => Math.random() - 0.5);
    this.rememberQuote(ctx.chatId, quote.msg_id);

    const seq = ++this.roundSeq;
    const round: GameRound = {
      seq,
      chatId: ctx.chatId,
      correctFromId: quote.from_id,
      options,
      quoteText: quote.text,
      quoteDate: quote.date_iso,
      quoteReactions: quote.reaction_total,
      endsAt: Date.now() + GAME_ROUND_MS,
      timer: null as unknown as NodeJS.Timeout,
      finished: false,
    };
    round.timer = setTimeout(() => {
      void this.revealRound(ctx.chatId, true);
    }, GAME_ROUND_MS);
    this.rounds.set(ctx.chatId, round);

    const buttons = options.map((o, i) => ({ text: o.label, callback_data: `g:${seq}:${i}` }));
    await this.send({
      chatId: ctx.chatId,
      text: formatGameQuestion(quote),
      replyTo: ctx.replyTo,
      markup: { inline_keyboard: [buttons] },
    });
  }

  private async revealRound(chatId: string, timedOut: boolean): Promise<void> {
    if (!this.d.session.enabled) {
      // фикс: после /off ревил не вскрывает выключенного бота ни по одному пути
      const stuck = this.rounds.get(chatId);
      if (stuck) {
        clearTimeout(stuck.timer);
        this.rounds.delete(chatId);
      }
      return;
    }
    const round = this.rounds.get(chatId);
    if (!round || round.finished) return;
    round.finished = true;
    clearTimeout(round.timer);
    this.rounds.delete(chatId);
    const author = this.d.directory.get().find((e) => e.fromId === round.correctFromId);
    const name = author?.name ?? 'неизвестный';
    const lines = [
      timedOut ? '⏰ Время вышло!' : '🎉 Есть попадание!',
      `✅ ${name} · [${formatDate(round.quoteDate)}] · 🔥 ${round.quoteReactions}`,
      `«${truncate(round.quoteText, 400)}»`,
    ];
    const top = this.topScoresLine(chatId);
    if (top) lines.push(`🏆 Сессия: ${top}`);
    await this.send({ chatId, text: lines.join('\n') });
  }

  // --- изобрази ---

  /** /изобрази <имя> [тема…]: раунд «Изобрази автора» — пародии реплаями. */
  private async cmdImprov(args: string, ctx: CommandCtx): Promise<void> {
    const words = args.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      await this.reply(ctx.chatId, 'Формат: /изобрази <имя> [тема…] — кого изображаем?', ctx.replyTo);
      return;
    }
    const activeEnds = this.activeGameEndsAt(ctx.chatId);
    if (activeEnds !== null) {
      const sec = Math.max(1, Math.round((activeEnds - Date.now()) / 1000));
      await this.reply(ctx.chatId, `Раунд уже идёт, осталось ${sec} с.`, ctx.replyTo);
      return;
    }
    const { name: nameCandidate, themeWords, result: nameResult } = resolveGreedyName(words, (q) =>
      this.resolveOnce(q),
    );
    const theme = themeWords.join(' ');
    if (themeWords.length > 0 && !buildFtsQuery(theme)) {
      await this.reply(ctx.chatId, 'В теме одни стоп-слова. Конкретизируй.', ctx.replyTo);
      return;
    }
    if (nameResult.kind === 'ok') {
      await this.cmdImprovStart(nameResult.author, theme, ctx);
      return;
    }
    await this.runResolved(nameResult, nameCandidate, ctx, 'изобрази', theme);
  }

  private async cmdImprovStart(author: AuthorEntry, theme: string, ctx: CommandCtx): Promise<void> {
    // гард обязателен ЗДЕСЬ, а не только в cmdImprov: сюда ведёт и res:-кнопка
    // дизамбиги (60 с), за окно которой слот могла занять другая игра
    const activeEnds = this.activeGameEndsAt(ctx.chatId);
    if (activeEnds !== null) {
      const sec = Math.max(1, Math.round((activeEnds - Date.now()) / 1000));
      await this.reply(ctx.chatId, `Раунд уже идёт, осталось ${sec} с.`, ctx.replyTo);
      return;
    }
    let real: { msgId: number; text: string; dateIso: string; reactions: number } | null = null;
    if (theme) {
      // тема задана — настоящую цитату берём лучшую по теме (путь /сказал)
      const matchQuery = buildFtsQuery(theme);
      let hits: Array<{ topicId: number; msgId: number }> = [];
      try {
        hits = this.d.fts.get().search(BOT_CHAT_KEY, matchQuery, author.fromId, 200);
      } catch {
        hits = [];
      }
      const rows = this.d.store.getMessagesByKeys(
        BOT_CHAT_KEY,
        hits.map((h) => ({ topicId: h.topicId, msgId: h.msgId })),
      );
      const now = Date.now();
      const best = [...rows.values()]
        .filter((r) => r.text.length >= 40 && r.text.length <= 400 && !r.text.includes('http'))
        .map((row) => ({ row, score: scoreQuote(row.reaction_total, row.date_iso, now) }))
        .sort((a, b) => b.score - a.score)[0];
      real = best
        ? { msgId: best.row.msg_id, text: best.row.text, dateIso: best.row.date_iso, reactions: best.row.reaction_total }
        : null;
      if (!real) {
        await this.reply(ctx.chatId, `Про «${theme}» ${author.name} молчал.`, ctx.replyTo);
        return;
      }
    } else {
      const avoid = this.lastQuotes.get(ctx.chatId) ?? [];
      const row = this.d.store.randomAuthorGameQuote(BOT_CHAT_KEY, BOT_TOPIC_ID, author.fromId, {
        avoidMsgIds: avoid,
      });
      if (!row) {
        await this.reply(ctx.chatId, `У ${author.name} нет цитат для раунда.`, ctx.replyTo);
        return;
      }
      real = { msgId: row.msg_id, text: row.text, dateIso: row.date_iso, reactions: row.reaction_total };
    }
    this.rememberQuote(ctx.chatId, real.msgId);
    await this.improv.start({
      chatId: ctx.chatId,
      replyTo: ctx.replyTo,
      author,
      theme,
      real,
    });
  }

  // --- callback_query ---

  private async handleCallback(cb: TgCallbackQuery): Promise<void> {
    const msg = cb.message;
    const data = cb.data ?? '';
    if (!msg) {
      await this.safeAnswer(cb.id, undefined);
      return;
    }
    const chatId = String(msg.chat.id);
    const isOwner = this.isOwner(String(cb.from.id));
    const privateOwner = isOwner && msg.chat.type === 'private';
    if (!this.d.cfg.allowChats.has(chatId) && !privateOwner) return;

    if (data.startsWith('vote:')) {
      const [, token, idxRaw] = data.split(':');
      await this.improv.handleVote(
        cb.id,
        chatId,
        String(cb.from.id),
        cb.from.first_name ?? cb.from.username ?? 'участник',
        token ?? '',
        idxRaw ?? '',
      );
      return;
    }
    if (data.startsWith('g:')) {
      await this.handleGameCallback(cb, chatId, data);
      return;
    }
    if (!data.startsWith('res:')) {
      await this.safeAnswer(cb.id, undefined);
      return;
    }
    const [, token, fromId] = data.split(':');
    const p = this.pending.get(token);
    this.pending.delete(token);
    if (!p || p.expiresAt < Date.now() || p.chatId !== chatId) {
      await this.safeAnswer(cb.id, 'Выбор устарел, вызови команду заново');
      return;
    }
    await this.safeAnswer(cb.id, 'Принято');
    const entry = this.d.directory.get().find((e) => e.fromId === fromId);
    if (!entry) return;
    const ctx: CommandCtx = {
      chatId: p.chatId,
      userId: String(cb.from.id),
      userName: cb.from.first_name ?? 'участник',
      replyTo: p.replyTo,
      replyText: p.replyText,
      isOwner,
    };
    try {
      if (p.cmdName === 'сказал') {
        await this.sendSaidQuotes(entry, p.argsText, buildFtsQuery(p.argsText), ctx);
      } else if (p.cmdName === 'изобрази') {
        await this.cmdImprovStart(entry, p.argsText, ctx);
      } else {
        await this.sendAuthorQuote(entry, ctx);
      }
    } catch (err) {
      console.error(`[tg-bot] callback-dispatch упал: ${errText(err)}`);
    }
  }

  private async handleGameCallback(cb: TgCallbackQuery, chatId: string, data: string): Promise<void> {
    const round = this.rounds.get(chatId);
    const [, seqRaw, idxRaw] = data.split(':');
    if (!round || round.finished || String(round.seq) !== seqRaw) {
      await this.safeAnswer(cb.id, 'Раунд уже завершён');
      return;
    }
    const picked = round.options[Number(idxRaw)];
    if (!picked) {
      await this.safeAnswer(cb.id, undefined);
      return;
    }
    if (picked.fromId === round.correctFromId) {
      const entry = this.addScore(chatId, String(cb.from.id), cb.from.first_name ?? 'участник', 1);
      await this.safeAnswer(cb.id, `Верно, ${entry.name}! +1`);
      await this.revealRound(chatId, false);
    } else {
      await this.safeAnswer(cb.id, 'Мимо 🙂');
    }
  }

  // --- admin (только owner) ---

  private async cmdReindex(ctx: CommandCtx): Promise<void> {
    const idx = rebuildFtsFull(this.d.store, this.d.fts);
    await this.reply(
      ctx.chatId,
      `♻️ FTS пересобран: ${idx.added} док. за ${(idx.ms / 1000).toFixed(1)} с, курсор msg_id=${idx.maxId}.`,
      ctx.replyTo,
    );
  }

  private async cmdAlias(args: string, ctx: CommandCtx): Promise<void> {
    const parts = args.split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
      await this.reply(ctx.chatId, 'Формат: /алиас <ник> <имя-автора>', ctx.replyTo);
      return;
    }
    const nick = parts[0];
    const authorName = parts.slice(1).join(' ');
    const r = this.resolveOnce(authorName);
    if (r.kind === 'none') {
      const names = r.suggestions.map((s) => s.name).join(', ');
      await this.reply(ctx.chatId, `Не нашёл «${authorName}».${names ? ` Ближайшие: ${names}.` : ''}`, ctx.replyTo);
      return;
    }
    if (r.kind === 'ambiguous') {
      const names = r.options
        .slice(0, 8)
        .map((o) => `• ${o.name} (${o.textMessages} сообщ.)`)
        .join('\n');
      await this.reply(ctx.chatId, `«${authorName}» неоднозначно, уточни имя:\n${names}`, ctx.replyTo);
      return;
    }
    this.d.store.upsertAlias(nick, r.author.fromId);
    await this.reply(ctx.chatId, `Алиас «${nick}» → ${r.author.name} сохранён.`, ctx.replyTo);
  }

  private async cmdSetEnabled(enabled: boolean, ctx: CommandCtx): Promise<void> {
    this.d.session.enabled = enabled;
    this.d.store.setState('enabled', enabled ? '1' : '0');
    if (!enabled) {
      // рубильник гасит активный раунд ЛЮБОЙ игры в этом чате (и /игра, и /изобрази)
      const round = this.rounds.get(ctx.chatId);
      if (round && !round.finished) {
        clearTimeout(round.timer);
        this.rounds.delete(ctx.chatId);
        await this.send({ chatId: ctx.chatId, text: '🛑 Раунд прерван владельцем' });
      }
      this.improv.cancelActive(ctx.chatId);
    }
    await this.reply(
      ctx.chatId,
      enabled ? '✅ Бот включён.' : '🛑 Бот выключен (отвечает только владельцу). Включить: /on',
      ctx.replyTo,
    );
  }

  private async cmdStat(ctx: CommandCtx): Promise<void> {
    const d = this.d;
    const uptimeSec = Math.round((Date.now() - d.session.startedAt) / 1000);
    const lines = [
      `Апдейтов за сессию: ${d.session.updatesSeen}`,
      `Очередь отправки: ${d.queue.size()}`,
      `Бот: ${d.session.enabled ? 'включён' : 'выключен'}`,
      `FTS: ${d.fts.get().countDocs()} док., курсор msg_id=${d.fts.get().getMaxIndexed()}, файл ${(d.fts.get().fileSizeBytes() / 1024 / 1024).toFixed(1)} МБ`,
      `Алиасов: ${d.store.countAliases()}`,
      `Каталог авторов: ${d.directory.get().length}`,
      `Аптайм: ${Math.floor(uptimeSec / 60)} мин ${uptimeSec % 60} с`,
    ];
    await this.reply(ctx.chatId, lines.join('\n'), ctx.replyTo);
  }

  // --- прочее ---

  private isOwner(userId: string): boolean {
    return this.d.cfg.ownerChatId != null && userId === this.d.cfg.ownerChatId;
  }

  /** Общая сессионная доска /игра и /изобрази (in-memory, умирает при рестарте). */
  private addScore(chatId: string, userId: string, name: string, delta: number): { name: string; score: number } {
    const board = this.scores.get(chatId) ?? new Map<string, { name: string; score: number }>();
    const entry = board.get(userId) ?? { name, score: 0 };
    entry.score += delta;
    board.set(userId, entry);
    this.scores.set(chatId, board);
    return entry;
  }

  private topScoresLine(chatId: string): string {
    const board = this.scores.get(chatId);
    return [...(board?.values() ?? [])]
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((s) => `${s.name} — ${s.score}`)
      .join(' · ');
  }

  /** Некликнутые токены дизамбиги живут 60 с (RESOLVE_TTL_MS) — подметаем лениво
   *  при каждой новой выдаче кнопок; это единственная растущая in-memory структура. */
  private sweepPending(): void {
    const now = Date.now();
    for (const [token, p] of this.pending) {
      if (p.expiresAt < now) this.pending.delete(token);
    }
  }

  private rememberQuote(chatId: string, msgId: number): void {
    const arr = this.lastQuotes.get(chatId) ?? [];
    arr.push(msgId);
    while (arr.length > 5) arr.shift();
    this.lastQuotes.set(chatId, arr);
  }

  private async reply(chatId: string, text: string, replyTo?: number): Promise<void> {
    await this.send({ chatId, text, replyTo });
  }

  private async send(m: OutboundMessage): Promise<void> {
    await this.d.queue.enqueue(m);
  }

  private async safeAnswer(callbackId: string, text?: string): Promise<void> {
    try {
      await this.d.api.answerCallbackQuery(callbackId, text);
    } catch (err) {
      console.error(`[tg-bot] answerCallbackQuery: ${errText(err)}`);
    }
  }
}

// --- каталог авторов с кэшем (GROUP BY по 950k строк ~2 с — не на каждую команду) ---

class AuthorDirectory {
  private entries: AuthorEntry[] | null = null;
  private builtAt = 0;
  private static readonly TTL_MS = 15 * 60_000;

  constructor(private readonly store: BotStore) {}

  get(): AuthorEntry[] {
    if (!this.entries || Date.now() - this.builtAt > AuthorDirectory.TTL_MS) {
      const t0 = Date.now();
      this.entries = this.store.getAuthorDirectory(BOT_CHAT_KEY, BOT_TOPIC_ID, BOT_CHANNEL_FROM_ID);
      this.builtAt = Date.now();
      console.error(`[tg-bot] каталог авторов: ${this.entries.length} записей за ${Date.now() - t0} мс`);
    }
    return this.entries;
  }
}

// --- FTS-хранилище бота: держатель с ленивым открытием (пересборка подменяет файл) ---

class FtsHolder {
  private current: FtsStore | null = null;

  constructor(private readonly path: string) {}

  open(): void {
    if (!this.current) this.current = new FtsStore(this.path);
  }

  get(): FtsStore {
    this.open();
    return this.current as FtsStore;
  }

  close(): void {
    this.current?.close();
    this.current = null;
  }

  /** Хвосты прерванной пересборки (.build) — не мусорим в .data. */
  discardBuildArtifacts(): void {
    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(this.buildPath() + suffix, { force: true });
    }
  }

  buildPath(): string {
    return `${this.path}.build`;
  }

  /** Подменить основной файл свежесобранным (оба ДБ должны быть закрыты). */
  replaceWith(buildFilePath: string): void {
    this.close();
    for (const suffix of ['', '-wal', '-shm']) rmSync(this.path + suffix, { force: true });
    renameSync(buildFilePath, this.path);
  }
}

/**
 * Полная пересборка FTS: строим с нуля в свежий .build-файл и подменяем им
 * основной. Перестройка поверх живого 190-МБ файла упирается в freelist-чурн
 * и медленные страницы (71 с против ~12 с на чистом файле, замер 2026-09-24).
 */
function rebuildFtsFull(store: BotStore, fts: FtsHolder): {
  added: number;
  ms: number;
  maxId: number;
} {
  const buildPath = fts.buildPath();
  for (const suffix of ['', '-wal', '-shm']) rmSync(buildPath + suffix, { force: true });
  const build = new FtsStore(buildPath, { disposable: true });
  let result: { added: number; ms: number; maxId: number };
  try {
    result = catchUpFtsIndex(store, build);
  } finally {
    build.close();
  }
  fts.replaceWith(buildPath);
  return result;
}

// --- FTS-догон (батчи по 50k: коммит/курсор реже — полная сборка ~2× быстрее;
// курсор переживает рестарт, незакоммиченный хвост пересобирается) ---

export function catchUpFtsIndex(store: BotStore, fts: FtsStore): {
  added: number;
  ms: number;
  maxId: number;
} {
  const t0 = Date.now();
  let maxId = fts.getMaxIndexed();
  let added = 0;
  const BATCH = 50_000;
  // Read-ahead на один батч: чтение из tg.sqlite и запись в FTS-файл — два
  // потока I/O по одному диску, конвейер прячет чтение за записью.
  let ahead = store.iterMessagesAfter(BOT_CHAT_KEY, BOT_TOPIC_ID, maxId, BATCH);
  while (ahead.length > 0) {
    const rows = ahead;
    maxId = rows[rows.length - 1].msg_id;
    ahead = store.iterMessagesAfter(BOT_CHAT_KEY, BOT_TOPIC_ID, maxId, BATCH);
    fts.indexRows(rows);
    fts.setMaxIndexed(maxId);
    added += rows.length;
  }
  return { added, ms: Date.now() - t0, maxId };
}

// --- форматирование (экспорт для тестов: дата в реальной цитате — инвариант) ---

export function formatDate(dateIso: string): string {
  const d = dateIso.slice(0, 10);
  const [y, m, day] = d.split('-');
  if (!y || !m || !day) return dateIso;
  return `${day}.${m}.${y}`;
}

export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max).trimEnd()}…` : s;
}

/** Вопрос /игра: дата обязательна (реальная цитата), имя автора НЕ показываем. */
export function formatGameQuestion(quote: { text: string; date_iso: string }): string {
  return `🎯 Кто это сказал?\n\n[${formatDate(quote.date_iso)}] «${truncate(quote.text, 400)}»\n\n⏱ 90 секунд`;
}

export function formatQuoteCard(row: { from_name: string; text: string; date_iso: string }): string {
  return `[${formatDate(row.date_iso)}] ${row.from_name}:\n${truncate(row.text, 600)}`;
}

// --- прочее ---

function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done(): void {
      clearTimeout(t);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done);
  });
}

