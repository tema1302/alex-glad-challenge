// Санитация tainted-контента на границах (RSS/forum/TG → БД/LLM-промпт).
//
// Вырезает control-символы (кроме \t и переносов), trim, обрезка по длине.
// Поведение идентично бывшим локальным копиям в dialogDb.ts и tg/topicCollector.ts:
// control chars вырезаются, .trim(), .slice(0, maxLen). maxLen опционален —
// без него обрезки нет (для RSS-полей, где длина уже ограничена выше по стеку).

/**
 * Удалить control chars (кроме \t), обрезать по краям и по длине.
 * @param s - tainted строка
 * @param maxLen - опц. ограничение длины (slice); без значения длина не режется
 */
export function clean(s: string, maxLen?: number): string {
  const out = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim();
  return maxLen != null ? out.slice(0, maxLen) : out;
}
