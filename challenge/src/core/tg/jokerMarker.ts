// Порт 🎭-гейта «воображаемого» (web/lib/shared/joker-marker.ts + joke-guard.ts)
// для бота «Медиум». Контракт маркера кодифицирован здесь и покрыт тестами:
// воображаемая реплика ОБЯЗАНА начинаться с 🎭 в первой строке; без маркера
// наружу не уходит ничего — 1 ретрай, затем fallback с гарантированным маркером.
// Потребитель — /какбы (bot.ts, M3).
//
// Контракт маркера: первая строка вида «🎭 Дух <display_name>: …» —
// 🎭 + содержимое, без обязательного слова «воображаем».

export const FAKT_MARKER_RE = /^🎭\s*\S/;

/** Маркер обязан быть в ПЕРВОЙ строке (как hasJokerMarker). */
export function hasFaktMarker(answer: string): boolean {
  if (!answer) return false;
  const nl = answer.indexOf('\n');
  const firstLine = nl < 0 ? answer : answer.slice(0, nl);
  return FAKT_MARKER_RE.test(firstLine);
}

/** Fallback с гарантированно валидным маркером (порт JOKER_FALLBACK).
 *  «Отдышался» = LLM не ответил дважды или вернул текст без обязательного 🎭.
 *  Это защитный fallback, а не баг; реальные цитаты всё ещё можно получить через /сказал. */
export function buildFaktFallback(displayName: string): string {
  return (
    `🎭 Дух ${displayName} отдышался — стилизатор не выдал валидную реплику. Попробуй позже.\n` +
    'Реальные слова надёжнее: /medium_said ' + displayName
  );
}

/** 1 попытка + ровно 1 ретрай (порт MAX_ATTEMPTS=2 из joke-guard). */
export const MAX_GUARD_ATTEMPTS = 2;

export interface GuardedImagined {
  text: string;
  /** true — сгенерированный ответ прошёл гейт; false — сработал fallback. */
  passed: boolean;
}

/**
 * Нестримовый гейт (бот шлёт целыми сообщениями): генерируем, проверяем маркер
 * первой строки; невалид/ошибка генерации → ретрай; снова мимо → fallback.
 * Генератор может делать ровно MAX_GUARD_ATTEMPTS вызовов — не больше.
 */
export async function guardImaginedReply(
  generate: () => Promise<string>,
  displayName: string,
): Promise<GuardedImagined> {
  for (let attempt = 0; attempt < MAX_GUARD_ATTEMPTS; attempt++) {
    let answer: string;
    try {
      answer = await generate();
    } catch {
      continue;
    }
    if (hasFaktMarker(answer)) return { text: answer, passed: true };
  }
  return { text: buildFaktFallback(displayName), passed: false };
}
