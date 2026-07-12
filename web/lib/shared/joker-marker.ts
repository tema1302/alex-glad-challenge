// Client-safe контракт CINE-PUN-маркера «🎬 <Фильм> (<год>) — <сцена>» первой строкой.
// Без серверных импортов, без core/ — импортируется и сервером (joke-guard.ts), и
// Node-скриптом (web/scripts/joker-smoke.mjs). Single source of truth для regex:
// клиентский parseBadge (app/joker/page.tsx) парсит badge по похожему контракту, но
// здесь — серверный gate для валидации ответа до стрима клиенту.

// Строится эмпирически под реальный маркер «🎬 Film (YYYY) — scene»:
//   • начинается с 🎬;
//   • непустое название (≥1 не-whitespace);
//   • год в скобках из 4 цифр;
//   • разделитель — em-dash (—), en-dash (–) или дефис (-) после «)».
// Лояльнее к разделителю, чем строгий /\s\(\d{4}\)\s/ (реальный маркер имеет « — »,
// а не требование whitespace после «)»).
export const JOKER_MARKER_RE = /^🎬\s+\S[^\n]*\(\d{4}\)\s*[—–-]/;

// Маркер обязан быть в ПЕРВОЙ строке (контракт промпта). Если ответ длинный —
// проверяем только первую строку, иначе весь answer (короткий ответ без \n).
export function hasJokerMarker(answer: string): boolean {
  if (!answer) return false;
  const nl = answer.indexOf('\n');
  const firstLine = nl < 0 ? answer : answer.slice(0, nl);
  return JOKER_MARKER_RE.test(firstLine);
}

// Детектор zh/CoT-leakage (R8, log-only). Разрешённый набор: кириллица, латиница
// (крылатые фразы типа «I'll be back» — легитимны в few-shot), пунктуация, пробелы,
// цифры, эмодзи 🎬, №. Всё прочее (CJK-иероглифы, хирагана, деванагари и т.д.)
// считается leakage. Триггер: доля «плохих» символов в теле свыше порога И их ≥3
// (защита от единичного экзотичного символа — не шум).
const ALLOWED_RE = /[\p{sc=Cyrillic}\p{sc=Latin}\p{P}\s\d🎬№]/u;
const LEAKAGE_RATIO = 0.1;
const LEAKAGE_MIN_CHARS = 3;

export function leakageSample(answer: string): { has: boolean; sample: string } {
  if (!answer) return { has: false, sample: '' };
  // Тело реплики — после маркера/первой строки (там zh-утечка наиболее вероятна).
  const nl = answer.indexOf('\n');
  const body = nl >= 0 ? answer.slice(nl + 1) : answer;
  if (body.length === 0) return { has: false, sample: '' };

  let bad = 0;
  let firstBad = -1;
  for (let i = 0; i < body.length; i++) {
    if (!ALLOWED_RE.test(body[i])) {
      bad++;
      if (firstBad < 0) firstBad = i;
    }
  }
  const ratio = bad / body.length;
  const has = ratio > LEAKAGE_RATIO && bad >= LEAKAGE_MIN_CHARS;
  const sample = has && firstBad >= 0
    ? body.slice(Math.max(0, firstBad - 5), firstBad + 35)
    : '';
  return { has, sample };
}
