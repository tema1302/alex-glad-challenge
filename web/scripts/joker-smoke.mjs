#!/usr/bin/env node
// Smoke-batch для /api/joke/session: 10 canned-промптов, reset+POST, парсинг SSE до
// done.answer, проверка маркера «🎬 Фильм (год) — сцена». Критерий ≥9/10 pass → exit 0.
//
// Запуск (после `pnpm --filter web start` на loopback 127.0.0.1:3000):
//   node web/scripts/joker-smoke.mjs
//   SMOKE_BASE=http://127.0.0.1:3001 node web/scripts/joker-smoke.mjs   (альтернативный порт)
//
// Regex маркера ПРОДУБЛИРОВАН из web/lib/shared/joker-marker.ts (single source of truth
// там). Smoke — standalone Node ESM без bundler/tsx; .ts импортировать нельзя. Если
// контракт маркера меняется — править ОБА места.
const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:3000';

// Контракт CINE-PUN (см. web/lib/shared/joker-marker.ts).
const JOKER_MARKER_RE = /^🎬\s+\S[^\n]*\(\d{4}\)\s*[—–-]/;

function hasJokerMarker(answer) {
  if (!answer) return false;
  const nl = answer.indexOf('\n');
  const firstLine = nl < 0 ? answer : answer.slice(0, nl);
  return JOKER_MARKER_RE.test(firstLine);
}

// Парсит SSE-стрим до первого done.answer. Бросает, если stream закрылся без done.
async function readSseDoneAnswer(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, sep).trim();
      buf = buf.slice(sep + 2);
      if (!raw.startsWith('data:')) continue;
      const dataLine = raw.slice(5).trim();
      if (!dataLine) continue;
      let ev;
      try {
        ev = JSON.parse(dataLine);
      } catch {
        continue;
      }
      if (ev.type === 'done' && typeof ev.answer === 'string') {
        return ev.answer;
      }
      if (ev.type === 'error') {
        throw new Error(`server error: ${ev.message ?? 'unknown'}`);
      }
    }
  }
  throw new Error('stream closed without done');
}

const PROMPTS = [
  'Совсем нет сил ничего делать.',
  'Начальник опять просит остаться после шести.',
  'Бросил спортзал через неделю.',
  'привет',
  'что умеешь',
  'расскажи шутку',
  'скука',
  'я устал сегодня',
  'посоветуй фильм на вечер',
  'как дела',
];

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function resetSession() {
  await fetch(`${BASE}/api/joke/session`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ reset: true }),
  });
}

async function main() {
  let pass = 0;
  for (const text of PROMPTS) {
    await resetSession();
    const r = await fetch(`${BASE}/api/joke/session`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ text, temperature: 0.9 }),
    });
    if (!r.ok || !r.body) {
      console.log(`FAIL | ${text} -> HTTP ${r.status}`);
      continue;
    }
    let answer;
    try {
      answer = await readSseDoneAnswer(r.body);
    } catch (e) {
      console.log(`FAIL | ${text} -> ${e.message}`);
      continue;
    }
    const ok = hasJokerMarker(answer);
    if (ok) pass++;
    // JSON.stringify чтобы \n виден как литерал — дословная структура (маркер\nреплика).
    const preview = JSON.stringify(answer.slice(0, 80));
    console.log(`${ok ? 'PASS' : 'FAIL'} | ${text} -> ${preview}`);
  }
  console.log(`\n${pass}/${PROMPTS.length} marker OK`);
  process.exit(pass >= 9 ? 0 : 1);
}

main().catch((e) => {
  console.error('smoke crashed:', e);
  process.exit(2);
});
