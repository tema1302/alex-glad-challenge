// Имя → автор для бота «Фактчемпик»: нормализация, алиасы, дизамбигуация.
// Чистый модуль (без node:sqlite) — бот-стор отдаёт каталог, здесь только логика.
// Спек: prompts/factchempik-bot.md §3. from_id НИКОГДА не попадает в человеко-
// читаемый вывод — эти типы для внутренних решений, display name — из from_name.

export interface AuthorEntry {
  fromId: string;
  name: string;
  messages: number;
  textMessages: number;
  firstDate: string;
  lastDate: string;
}

export type ResolveResult =
  | { kind: 'ok'; author: AuthorEntry }
  | { kind: 'none'; suggestions: AuthorEntry[] }
  | { kind: 'ambiguous'; options: AuthorEntry[] };

/** trim, lower, ё→е, схлопывание пробелов. */
export function normalizeName(s: string): string {
  return s.trim().toLowerCase().replaceAll('ё', 'е').replace(/\s+/g, ' ');
}

/** Кандидаты на подсказку при полном промахе: префиксный бонус + объём текста. */
export function pickSuggestions(
  query: string,
  entries: readonly AuthorEntry[],
  limit = 3,
): AuthorEntry[] {
  const q = normalizeName(query);
  const scored = entries.map((e) => {
    const n = normalizeName(e.name);
    let score = e.textMessages / 1000;
    if (q.length >= 2 && n.startsWith(q.slice(0, 2))) score += 100;
    if (q.length >= 1 && n.startsWith(q.slice(0, 1))) score += 50;
    return { e, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.e);
}

/**
 * Резолв: точный алиас → автор; числовой запрос → from_id; иначе подстрока по
 * всем вариантам (from_name, from_id) с нормализацией. Совпадения сворачиваются
 * по from_id (display name — вариант с максимумом сообщений).
 */
export function resolveAuthor(
  query: string,
  entries: readonly AuthorEntry[],
  aliases: ReadonlyMap<string, string>,
): ResolveResult {
  const q = normalizeName(query);
  if (!q) return { kind: 'none', suggestions: pickSuggestions(query, entries) };

  const collapsed = collapseByAuthor(entries);
  const byId = new Map(collapsed.map((e) => [e.fromId, e]));

  const aliasId = aliases.get(q);
  if (aliasId) {
    const author = byId.get(aliasId);
    if (author) return { kind: 'ok', author };
  }

  if (/^\d+$/.test(q)) {
    const author = byId.get(q);
    if (author) return { kind: 'ok', author };
  }

  const matches = new Map<string, AuthorEntry>();
  for (const e of entries) {
    if (!normalizeName(e.name).includes(q)) continue;
    const existing = matches.get(e.fromId);
    if (!existing) matches.set(e.fromId, e);
    else if (e.messages > existing.messages) matches.set(e.fromId, e);
  }
  const options = [...matches.values()].sort((a, b) => b.textMessages - a.textMessages);
  if (options.length === 1) return { kind: 'ok', author: options[0] };
  if (options.length > 1) return { kind: 'ambiguous', options };
  return { kind: 'none', suggestions: pickSuggestions(query, entries) };
}

/** Один from_id = одна запись: счётчики суммируются, display name — вариант
 *  с максимумом сообщений, даты — объединяются. */
export function collapseByAuthor(entries: readonly AuthorEntry[]): AuthorEntry[] {
  const acc = new Map<string, { entry: AuthorEntry; variantMax: number }>();
  for (const e of entries) {
    const a = acc.get(e.fromId);
    if (!a) {
      acc.set(e.fromId, { entry: { ...e }, variantMax: e.messages });
      continue;
    }
    a.entry.messages += e.messages;
    a.entry.textMessages += e.textMessages;
    if (e.firstDate < a.entry.firstDate) a.entry.firstDate = e.firstDate;
    if (e.lastDate > a.entry.lastDate) a.entry.lastDate = e.lastDate;
    if (e.messages > a.variantMax) {
      a.variantMax = e.messages;
      a.entry.name = e.name;
    }
  }
  return [...acc.values()].map((a) => a.entry);
}

/**
 * Жадный резолв аргументов /сказал: имя = 1 токен (тема — остаток); если первый
 * токен none/ambiguous — ДО кнопок дизамбиги пробуем 2-токенное имя (кейс
 * «/сказал Вячеслав Назаренко …»: «вячеслав» амбигвален, двухсловное имя уникально).
 */
export function resolveGreedyName(
  words: string[],
  resolve: (query: string) => ResolveResult,
): { name: string; themeWords: string[]; result: ResolveResult } {
  const name = words[0] ?? '';
  let result = resolve(name);
  let themeWords = words.slice(1);
  if (words.length > 1 && (result.kind === 'none' || result.kind === 'ambiguous')) {
    const two = `${words[0]} ${words[1]}`;
    const twoResult = resolve(two);
    if (twoResult.kind !== 'none') {
      return { name: two, themeWords: words.slice(2), result: twoResult };
    }
  }
  return { name, themeWords, result };
}
