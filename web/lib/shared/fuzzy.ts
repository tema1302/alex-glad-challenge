// Fuzzy-поиск для командной палитры: подпоследовательность символов без
// регулярок и внешних зависимостей. Кириллица работает из коробки через
// toLowerCase(). Публичный контракт:
//   fuzzyScore(query, text) → число (больше = лучше) | null (не совпало)
//   rankByQuery(query, items, getText) → отфильтрованный и отсортированный список
// Порядок при равном счёте стабильный (исходный порядок массива сохраняется).

function isLetterOrDigit(ch: string): boolean {
  return /[a-zа-яё0-9]/i.test(ch);
}

/** Счёт одного токена-подпоследовательности; null — токен не встречается. */
function tokenScore(token: string, text: string): number | null {
  let score = 0;
  let ti = 0;
  let prevMatch = -2;
  for (let i = 0; i < text.length && ti < token.length; i++) {
    if (text[i] !== token[ti]) continue;
    const boundary = i === 0 || !isLetterOrDigit(text[i - 1]);
    // Совпадение по границе слова ценнее совпадения внутри слова.
    score += boundary ? 3 : 1;
    // Серия подряд идущих символов (i === prevMatch + 1) — признак префикса.
    if (prevMatch >= 0 && i === prevMatch + 1) score += 2;
    // Первый символ токена: с начала слова / с начала строки — сильный сигнал.
    if (ti === 0 && boundary) score += 4;
    if (ti === 0 && i === 0) score += 6;
    prevMatch = i;
    ti++;
  }
  return ti < token.length ? null : score;
}

/**
 * Счёт совпадения запроса со строкой. Все токены запроса (разделение по
 * пробелам) должны найтись — иначе null. Пустой запрос не имеет смысла для
 * скоринга: вызывающий код обрабатывает его до fuzzyScore.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().trim();
  const t = text.toLowerCase();
  if (q.length === 0) return null;
  const tokens = q.split(/\s+/);
  let total = 0;
  for (const token of tokens) {
    const s = tokenScore(token, t);
    if (s === null) return null;
    total += s;
  }
  return total;
}

/**
 * Ранжирует items по запросу. Пустой/пробельный запрос возвращает список
 * как есть (без пересортировки) — палитра показывает все команды.
 */
export function rankByQuery<T>(query: string, items: readonly T[], getText: (item: T) => string): T[] {
  if (query.trim().length === 0) return [...items];
  return items
    .map((item, idx) => ({ item, idx, score: fuzzyScore(query, getText(item)) }))
    .filter((x): x is { item: T; idx: number; score: number } => x.score !== null)
    .sort((a, b) => (b.score - a.score) || (a.idx - b.idx))
    .map((x) => x.item);
}
