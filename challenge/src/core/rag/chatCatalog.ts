// Каталог telegram-чатов для REPL `rag chat`: кэш chatKey→title (наполняется при
// index-tg, где MTProto уже резолвит title) + alias-файл name→{chatKey,topicId?}
// для человекочитаемого `/chat <name>`. Паттерн JSON-loader — memory.ts (existsSync
// → readFileSync → JSON.parse → try/catch → пустое при отсутствии/битом).
//
// Файлы (runtime-кэш в .data/, вне git — НЕ секрет):
//   .data/chat-titles.json   { "<chatKey>": "<title>" }
//   .data/chat-aliases.json  { "<name-lowercase>": { "chatKey": "-100…", "topicId"?: N } }
//
// Зачем: chat title физически не хранится в rag.sqlite (там from_name/TG topic) ни в
// tg.sqlite — единственный источник = MTProto entity.title. Кэш развязывает: наполняется
// в index-tg, в REPL `/chat` читается offline, без MTProto-per-call (решение пользователя).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { dataPath } from '../paths.js';

export interface ChatAlias {
  chatKey: string;
  topicId?: number;
}

const TITLES_FILE = dataPath('chat-titles.json');
const ALIASES_FILE = dataPath('chat-aliases.json');

function ensureDataDir(): void {
  if (!existsSync(dataPath())) mkdirSync(dataPath(), { recursive: true });
}

// --- chat-titles.json ---

/** Загружает кэш chatKey→title. Битый/отсутствующий файл → {} (runtime, не блокирует REPL). */
export function loadChatTitles(): Record<string, string> {
  if (!existsSync(TITLES_FILE)) return {};
  try {
    const raw = readFileSync(TITLES_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** Merge: сохраняет title для chatKey, pretty-print. No-op если title не изменился. */
export function saveChatTitle(chatKey: string, title: string): void {
  if (!chatKey || !title) return;
  ensureDataDir();
  const map = loadChatTitles();
  if (map[chatKey] === title) return;
  map[chatKey] = title;
  writeFileSync(TITLES_FILE, JSON.stringify(map, null, 2), 'utf-8');
}

// --- chat-aliases.json ---

/** Загружает alias-карту (name уже lowercase-ключ). Битый/отсутствующий → {}. */
export function loadAliases(): Record<string, ChatAlias> {
  if (!existsSync(ALIASES_FILE)) return {};
  try {
    const raw = readFileSync(ALIASES_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, ChatAlias> = {};
    for (const [name, v] of Object.entries(parsed)) {
      if (v && typeof v === 'object') {
        const a = v as { chatKey?: unknown; topicId?: unknown };
        if (typeof a.chatKey === 'string') {
          const entry: ChatAlias = { chatKey: a.chatKey };
          if (typeof a.topicId === 'number' && Number.isFinite(a.topicId)) entry.topicId = a.topicId;
          out[name.toLowerCase()] = entry;
        }
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function saveAliases(map: Record<string, ChatAlias>): void {
  ensureDataDir();
  writeFileSync(ALIASES_FILE, JSON.stringify(map, null, 2), 'utf-8');
}

/** Добавить/переписать alias. name нормализуется в lowercase-ключ. */
export function addAlias(name: string, chatKey: string, topicId?: number): void {
  const map = loadAliases();
  const entry: ChatAlias = { chatKey };
  if (topicId != null && Number.isFinite(topicId)) entry.topicId = topicId;
  map[name.toLowerCase()] = entry;
  saveAliases(map);
}

/** Удалить alias. true если был. */
export function removeAlias(name: string): boolean {
  const map = loadAliases();
  const key = name.toLowerCase();
  if (!(key in map)) return false;
  delete map[key];
  saveAliases(map);
  return true;
}

/** Case-insensitive lookup по имени. Возвращает stored-name + entry. */
export function findAliasByName(name: string): { name: string; alias: ChatAlias } | null {
  const map = loadAliases();
  const key = name.toLowerCase();
  const alias = map[key];
  return alias ? { name: key, alias } : null;
}

/** Обратный lookup: alias по chatKey (для /list). */
export function findAliasByChatKey(chatKey: string): { name: string; alias: ChatAlias } | null {
  const map = loadAliases();
  for (const [name, alias] of Object.entries(map)) {
    if (alias.chatKey === chatKey) return { name, alias };
  }
  return null;
}

// --- REPL resolve ---

export type ReplChatResolve =
  | { ok: true; chatKey: string; topicId?: number; origin: 'alias' | 'title' | 'numeric'; label: string }
  | { ok: false; error: string };

// Numeric offline-резолв chatKey БЕЗ MTProto: '-100<id>' или 't.me/c/<id>[/topic]'
// (topicId из URL игнорируем — в REPL он задаётся отдельным /topic).
function tryNumericChatKey(input: string): string | null {
  const s = input.trim();
  if (/^-100\d+$/.test(s)) return s;
  const m = s.match(/^https?:\/\/t\.me\/c\/(\d+)(?:\/\d+)?\/?$/i);
  if (m) return `-100${m[1]}`;
  return null;
}

/** Резолв `<name|ref>` для REPL `/chat`. Приоритет: alias → title (exact→substring) →
 *  numeric. Offline, без MTProto, без process.exit. >1 совпадения по title → «уточните». */
export function resolveChatRefForRepl(
  input: string,
  titles: Record<string, string>,
  aliases: Record<string, ChatAlias>,
): ReplChatResolve {
  const s = input.trim();
  if (!s) return { ok: false, error: 'пустой ввод.' };
  const needle = s.toLowerCase();

  // 1. Alias exact (case-insensitive).
  const alias = aliases[needle];
  if (alias) {
    const base = { ok: true as const, chatKey: alias.chatKey, origin: 'alias' as const, label: needle };
    return alias.topicId != null ? { ...base, topicId: alias.topicId } : base;
  }

  // 2. Exact title match (case-insensitive).
  const exact = Object.entries(titles).find(([, t]) => t.toLowerCase() === needle);
  if (exact) {
    return { ok: true, chatKey: exact[0], origin: 'title', label: exact[1] };
  }

  // 3. Substring title match: 1 — ok, >1 — «уточните».
  const subs = Object.entries(titles).filter(([, t]) => t.toLowerCase().includes(needle));
  if (subs.length === 1) {
    return { ok: true, chatKey: subs[0][0], origin: 'title', label: subs[0][1] };
  }
  if (subs.length > 1) {
    const list = subs.map(([k, t]) => `${t} (${k})`).join(', ');
    return { ok: false, error: `несколько чатов по «${s}»: ${list} — уточните.` };
  }

  // 4. Numeric offline.
  const numeric = tryNumericChatKey(s);
  if (numeric) {
    return { ok: true, chatKey: numeric, origin: 'numeric', label: numeric };
  }

  return {
    ok: false,
    error:
      `чат «${s}» не найден. Используйте numeric chatKey (-100…), t.me/c/<id>, ` +
      'либо добавьте alias: /alias add <name> <chatKey> [topicId].',
  };
}
