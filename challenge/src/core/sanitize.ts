// Санитация tainted-контента на границах (RSS/forum/TG → БД/LLM-промпт).
//
// Вырезает control-символы (кроме \t и переносов) и непарные суррогаты, trim,
// обрезка по длине без разрезания surrogate pair. Поведение идентично бывшим
// локальным копиям в dialogDb.ts и tg/topicCollector.ts: control chars
// вырезаются, .trim(), обрезка по maxLen. maxLen опционален — без него обрезки
// нет (для RSS-полей, где длина уже ограничена выше по стеку).

// Непарные суррогаты (половинки emoji после обрезки по UTF-16 единицам) —
// невалидный Unicode: JSON.stringify экранирует их как \udXXX, и строгие
// парсеры провайдеров (DeepSeek) отклоняют тело запроса с 400
// («unexpected end of hex escape»). Вырезаем halves, целые пары сохраняем.
const LONE_SURROGATES = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Удалить непарные суррогаты; целые surrogate pair (emoji) не трогает. */
export function stripLoneSurrogates(s: string): string {
  return s.replace(LONE_SURROGATES, '');
}

/**
 * Обрезка по длине без разрезания surrogate pair: если граница попала между
 * halves emoji — конец сдвигается на единицу назад. В остальном как .slice(0, maxLen).
 */
export function safeSlice(s: string, maxLen: number): string {
  if (maxLen <= 0) return '';
  if (s.length <= maxLen) return s;
  const last = s.charCodeAt(maxLen - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? maxLen - 1 : maxLen;
  return s.slice(0, end);
}

/**
 * Удалить control chars (кроме \t) и непарные суррогаты, обрезать по краям и по длине.
 * @param s - tainted строка
 * @param maxLen - опц. ограничение длины (safeSlice); без значения длина не режется
 */
export function clean(s: string, maxLen?: number): string {
  const out = stripLoneSurrogates(s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')).trim();
  return maxLen != null ? safeSlice(out, maxLen) : out;
}
