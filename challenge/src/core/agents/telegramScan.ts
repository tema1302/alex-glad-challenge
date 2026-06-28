// MTProto-клиент (GramJS) для сканирования истории чата (день 19).
//
// Bot API НЕ умеет читать чужую историю — только сообщения, пришедшие боту.
// Чтобы просканировать «последние N сообщений в чате», нужен userbot:
// api_id + api_hash + session (my.telegram.org → Apps). Session-строка
// генерируется одноразовым логином и хранится в .env (TG_SESSION).
//
// Сервер подключает клиент один раз (connectScanClient при старте) и переиспользует.

import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface ScannedMessage {
  from: string;
  text: string;
  date: string; // ISO
}

export interface ScanResult {
  chat: string;
  total: number;
  messages: ScannedMessage[];
}

// GramJS-объекты типизированы тяжело; работаем через минимальные интерфейсы,
// приводя к ним реальные объекты (поведение проверяется на живом логине).
interface DialogLike {
  title?: string;
  entity?: unknown;
}
interface MsgLike {
  message?: string;
  senderId?: { toString(): string } | bigint | number | null;
  date?: number;
  sender?: { firstName?: string; lastName?: string; title?: string; username?: string } | null;
}
interface ScanClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getEntity(peer: string): Promise<unknown>;
  getDialogs(opts: { limit: number }): Promise<DialogLike[]>;
  getMessages(entity: unknown, opts: { limit: number }): Promise<MsgLike[]>;
}

let client: ScanClient | null = null;

/** Где лежит файл сессии (тот же .data/, что и остальное runtime-состояние). */
const SESSION_FILE = path.join(process.cwd(), '.data', 'tg-session.json');

/**
 * Откуда брать StringSession: env TG_SESSION имеет приоритет, иначе читаем из
 * .data/tg-session.json ({ session: "..." }). null — если сессии нет нигде.
 */
function resolveSession(): string | null {
  const env = process.env.TG_SESSION;
  if (env && env.trim()) return env.trim();
  try {
    const obj = JSON.parse(readFileSync(SESSION_FILE, 'utf8')) as { session?: unknown };
    if (typeof obj.session === 'string' && obj.session.trim()) return obj.session.trim();
  } catch {
    /* файла нет или битый — не страшно */
  }
  return null;
}

export function isScanConfigured(): boolean {
  return Boolean(process.env.TG_API_ID && process.env.TG_API_HASH && resolveSession());
}

/** Подключить MTProto-клиента (один раз). false — если не настроено.
 * GramJS грузится лениво, чтобы сервер поднимался даже без установленного
 * `telegram` (или при сбое сети/сессии) — scan-тул просто деградирует. */
export async function connectScanClient(): Promise<boolean> {
  if (!isScanConfigured()) return false;
  if (client) return true;

  const sessionStr = resolveSession();
  if (!sessionStr) return false;
  const apiId = Number(process.env.TG_API_ID);
  const apiHash = process.env.TG_API_HASH as string;

  try {
    const { TelegramClient } = await import('telegram');
    const { StringSession } = await import('telegram/sessions');
    const raw = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, {
      connectionRetries: 3,
    });
    await Promise.race([
      raw.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('MTProto connect timed out (10s)')), 10_000),
      ),
    ]);
    client = raw as unknown as ScanClient;
    return true;
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    console.error(`MTProto connect failed: ${m}`);
    return false;
  }
}

export async function disconnectScanClient(): Promise<void> {
  if (client) {
    await client.disconnect();
    client = null;
  }
}

function senderName(m: MsgLike): string {
  const s = m.sender;
  if (s) {
    if (s.firstName || s.lastName) return [s.firstName, s.lastName].filter(Boolean).join(' ');
    if (s.title) return s.title;
    if (s.username) return '@' + s.username;
  }
  return m.senderId == null ? 'unknown' : String(m.senderId);
}

function msgDateIso(m: MsgLike): string {
  return typeof m.date === 'number' ? new Date(m.date * 1000).toISOString() : '';
}

/**
 * Прочитать последние `limit` сообщений из чата `chat`.
 * `chat` — username/@username, числовой id или заголовок (ищется в диалогах).
 */
export async function scanChatMessages(chat: string, limit: number): Promise<ScanResult> {
  if (!client) {
    const ok = await connectScanClient();
    if (!ok || !client) throw new Error('scan client not connected (MTProto unavailable)');
  }

  let entity: unknown;
  let title = chat;
  if (/^-?\d+$/.test(chat) || chat.startsWith('@')) {
    entity = await client.getEntity(chat);
  } else {
    const dialogs = await client.getDialogs({ limit: 200 });
    const found = dialogs.find((d) => (d.title ?? '').toLowerCase().includes(chat.toLowerCase()));
    if (!found?.entity) throw new Error(`chat "${chat}" not found in dialogs`);
    entity = found.entity;
    title = found.title ?? chat;
  }

  const msgs = await client.getMessages(entity, { limit });
  const messages: ScannedMessage[] = msgs.map((m) => ({
    from: senderName(m),
    text: m.message ?? '',
    date: msgDateIso(m),
  }));
  return { chat: title, total: messages.length, messages };
}

const STOP_WORDS = new Set([
  'и', 'в', 'во', 'на', 'не', 'что', 'это', 'я', 'а', 'с', 'по', 'для', 'но', 'же', 'бы',
  'ли', 'как', 'так', 'то', 'он', 'она', 'они', 'мы', 'вы', 'ты', 'его', 'ее', 'их',
  'the', 'a', 'an', 'to', 'of', 'and', 'in', 'is', 'it', 'for', 'on', 'with', 'as', 'at',
]);

/** Детерминированный отчёт по сообщениями (без LLM) — шаг «обработка». */
export function analyzeMessages(s: ScanResult): string {
  const ms = s.messages;
  const bySender: Record<string, number> = {};
  const termCount: Record<string, number> = {};
  let links = 0;

  for (const m of ms) {
    bySender[m.from] = (bySender[m.from] ?? 0) + 1;
    if (/https?:\/\//i.test(m.text)) links++;
    const tokens = m.text.toLowerCase().match(/[a-zа-яё0-9]{3,}/gi);
    if (tokens) {
      for (const w of tokens) {
        if (STOP_WORDS.has(w)) continue;
        termCount[w] = (termCount[w] ?? 0) + 1;
      }
    }
  }

  const topSenders = Object.entries(bySender)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v]) => `${k}(${v})`)
    .join(', ');
  const topTerms = Object.entries(termCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([k, v]) => `${k}:${v}`)
    .join(', ');
  const dates = ms.map((m) => m.date).filter(Boolean).sort();
  const range = dates.length ? `${dates[0]} … ${dates[dates.length - 1]}` : '—';

  return [
    `Анализ чата «${s.chat}» (${ms.length} сообщений)`,
    `Период: ${range}`,
    `Авторов: ${Object.keys(bySender).length}; топ: ${topSenders || '—'}`,
    `Ссылок: ${links}`,
    `Топ-термины: ${topTerms || '—'}`,
  ].join('\n');
}
