// Порт 🎭-гейта «воображаемого» (web/lib/shared/joker-marker.ts + joke-guard.ts)
// для бота «Фактчемпик». В M1 сам /какбы не строится, но контракт маркера уже
// кодифицирован здесь и покрыт тестами: воображаемая реплика ОБЯЗАНА начинаться
// с маркера в первой строке; без валидного маркера наружу не уходит ничего —
// 1 ретрай, затем fallback с гарантированно валидным маркером.
//
// Контракт маркера (спек §4 M3): первая строка вида
//   «🎭 Это воображаемая реплика в манере <display_name>, не настоящая»

export const FAKT_MARKER_RE = /^🎭\s+\S[^\n]*воображаем/i;

/** Маркер обязан быть в ПЕРВОЙ строке (как hasJokerMarker). */
export function hasFaktMarker(answer: string): boolean {
  if (!answer) return false;
  const nl = answer.indexOf('\n');
  const firstLine = nl < 0 ? answer : answer.slice(0, nl);
  return FAKT_MARKER_RE.test(firstLine);
}

/** Fallback с гарантированно валидным маркером (порт JOKER_FALLBACK). */
export function buildFaktFallback(displayName: string): string {
  return (
    `🎭 Это воображаемая реплика в манере ${displayName}, не настоящая\n` +
    'Стилизатор остыл — попробуй позже. Реальные слова лучше: /сказал ' + displayName
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
