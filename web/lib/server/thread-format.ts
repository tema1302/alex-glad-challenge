// Формат потока агента «Поток-перевод» (/antonov): разбор ответа модели на посты
// и страховка от превышения лимита ТГ. Чистые функции без server-only — юнит-тесты
// импортируют напрямую; роут использует вместе с THREAD_SYSTEM_PROMPT.
// Инварианты: разделитель ===ПОСТ=== (допускаем вариации модели: пробелы,
// нумерация, ---ПОСТ---); посты ТГ не длиннее TG_MAX_POST_LEN (жёсткий кап
// Telegram — 4096, держим запас).

/** Жёсткий кап одного поста потока (лимит Telegram 4096 с запасом). */
export const TG_MAX_POST_LEN = 4000;

/** Разделитель постов в ответе модели: строка целиком вида ===ПОСТ=== / === ПОСТ 2 ===. */
const THREAD_SEPARATOR = /^\s*[-=]{2,}\s*ПОСТ(?:\s*№?\s*\d+)?\s*[-=]{2,}\s*$/i;

/** Ответ модели → список непустых постов. Без разделителей = один пост. */
export function splitThreadResponse(raw: string): string[] {
  const posts: string[] = [];
  let current: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (THREAD_SEPARATOR.test(line)) {
      posts.push(current.join('\n'));
      current = [];
    } else {
      current.push(line);
    }
  }
  posts.push(current.join('\n'));
  return posts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * Пост длиннее max → несколько по границе абзацев (пустая строка), затем строк,
 * затем жёстко по символам. Каждая часть ≤ max; одна часть может быть < max —
 * это хвост, а не ошибка.
 */
export function splitLongPost(post: string, max: number = TG_MAX_POST_LEN): string[] {
  if (post.length <= max) return [post];
  const chunks: string[] = [];
  let current = '';

  const pushCurrent = (): void => {
    const trimmed = current.trim();
    if (trimmed.length > 0) chunks.push(trimmed);
    current = '';
  };

  const appendPiece = (piece: string): void => {
    if (current.length === 0) {
      current = piece;
      return;
    }
    current += piece;
  };

  for (const paragraph of post.split(/\n{2,}/)) {
    // Абзац сам длиннее max — режем его отдельно и текущий буфер закрываем.
    if (paragraph.length > max) {
      pushCurrent();
      let lineBuffer = '';
      for (const line of paragraph.split(/\n/)) {
        if (line.length > max) {
          if (lineBuffer.trim().length > 0) {
            chunks.push(lineBuffer.trim());
            lineBuffer = '';
          }
          for (let i = 0; i < line.length; i += max) {
            chunks.push(line.slice(i, i + max));
          }
          continue;
        }
        if (lineBuffer.length > 0 && lineBuffer.length + line.length + 1 > max) {
          chunks.push(lineBuffer.trim());
          lineBuffer = line;
        } else {
          lineBuffer = lineBuffer.length === 0 ? line : `${lineBuffer}\n${line}`;
        }
      }
      current = lineBuffer;
      continue;
    }
    if (current.length > 0 && current.length + paragraph.length + 2 > max) {
      pushCurrent();
      current = paragraph;
    } else {
      appendPiece(current.length === 0 ? paragraph : `\n\n${paragraph}`);
    }
  }
  pushCurrent();
  return chunks;
}
