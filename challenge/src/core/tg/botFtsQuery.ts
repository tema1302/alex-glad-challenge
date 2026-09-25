// Тема → FTS5-запрос для /сказал: OR-набор префиксных токенов (морфология
// префиксом `корень*` — русской стемминг-модели в sqlite FTS5 нет).
// Стоп-слова — готовый STOP_WORDS из core/agents/telegramScan.ts.

import { STOP_WORDS } from '../agents/telegramScan.js';

/** Значимые токены темы: lower, ё→е, [a-zа-яё0-9]{3,}, без стоп-слов, дедуп. */
export function tokenizeTheme(text: string): string[] {
  const raw = text.toLowerCase().replaceAll('ё', 'е').match(/[a-zа-я0-9]{3,}/g) ?? [];
  const seen = new Set<string>();
  for (const t of raw) {
    if (!STOP_WORDS.has(t)) seen.add(t);
  }
  return [...seen];
}

/**
 * FTS5 MATCH-строка: токены → `токен*`, OR-соединение. Пустая строка = темы нет
 * (после стоп-слов). Токены уже [a-zа-я0-9]+, поэтому в кавычки не заворачиваем.
 */
export function buildFtsQuery(theme: string, maxTerms = 6): string {
  return tokenizeTheme(theme)
    .slice(0, maxTerms)
    .map((t) => `${t}*`)
    .join(' OR ');
}

/**
 * Скоринг цитаты /сказал: буст reaction_total + свежесть (линейный спад до нуля
 * за freshnessYears лет). Детерминирован — покрыт тестом.
 */
export function scoreQuote(
  reactionTotal: number,
  dateIso: string,
  nowMs: number,
  freshnessYears = 4,
): number {
  const t = Date.parse(dateIso);
  if (!Number.isFinite(t)) return reactionTotal; // битая дата — без буста
  const daysOld = Math.max(0, (nowMs - t) / 86_400_000);
  const freshness = Math.max(0, 1 - daysOld / (freshnessYears * 365));
  return reactionTotal + 30 * freshness;
}

/** Значимые слова reply-сообщения как тема (3–5 слов по спеку). */
export function themeFromReplyText(replyText: string, maxWords = 4): string {
  return tokenizeTheme(replyText).slice(0, maxWords).join(' ');
}
