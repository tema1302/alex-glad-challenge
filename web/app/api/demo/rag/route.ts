// POST /api/demo/rag — публичный single-shot RAG-эндпоинт страницы /demo
// («Спроси мою базу знаний»). Гость без авторизации → полный контур защиты
// публичного LLM-endpoint (прецедент /api/jira/generate):
//   1) двойной rate-limit (per-IP 6 + глобальный предохранитель 60 на 15 мин,
//      in-memory fixed-window на globalThis — переживает HMR dev, сброс рестартом);
//   2) zod-граница demoRagSchema (question ≤300) + clean() tainted-вопроса;
//   3) LLM фиксирует сервер (cloud → fallback local; из запроса НЕ принимается);
//   4) retrieval ЖЁСТКО по публичной партиции strategy='structure' (руководство
//      EVOLUTE i-SPACE): RagStore.search строит WHERE strategy = ? — чанки партиций
//      telegram/docs физически не читаются из SQLite, утечка через промпт/цитаты
//      невозможна. Плюс defense-in-depth: страховочный дроп источника с
//      tg://|telegram в source/title/section/chunkId (chunkId в ответ не идёт).
//
// Контракт (заморожен, план §2): 200 {ok:true, answer, gaveUp,
// sources:[{n,title,section,snippet,score}]} — БЕЗ source/chunkId/tg-метаданных.
// Guard «не знаю» приходит как gaveUp=true при 200 (decideGuard шорткёрктит БЕЗ LLM).
// Ошибки: 400 (zod/не-JSON), 429 (+Retry-After), 502 (сеть/эмбеддер/LLM, safeMessage),
// 503 (LLM либо эмбеддинги не настроены). Недоступные embeddings → честный 502, БЕЗ
// fallback-ответа «без базы» (страница обещает ответы ИЗ базы знаний).
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { demoRagSchema } from '../../../../lib/shared/forms';
import { Retriever, makeEmbedder, answerWithRag, clean } from '../../../../lib/server/challenge';
import { getRagStore, withDb } from '../../../../lib/server/db';
import { pickLlmClient } from '../../../../lib/server/llm';
import { getKeysStatus } from '../../../../lib/server/env';
import { safeMessage } from '../../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Публичный корпус демо: единственная партиция, куда пойдёт поиск (см. шапку).
const PUBLIC_STRATEGY = 'structure';
const TIMEOUT_MS = 45_000; // abort всего RAG-прогона (retrieval + LLM)
const MAX_ANSWER_LEN = 2000;
const SNIPPET_LEN = 200;
const TOP_K = 4;

// Rate-limit (fixed-window): per-IP 6 запросов / 15 мин + глобальный предохранитель
// 60 / 15 мин против распределённого дожигания ключей. XFF подделывается за прокси —
// лимиты остаточные (как у /jira); константы легко крутить.
const RATE_PER_IP = 6;
const RATE_GLOBAL = 60;
const RATE_WINDOW_MS = 15 * 60 * 1000;

interface RateWindow {
  count: number;
  resetAt: number;
}

// Модульное состояние окон (globalThis — переживает HMR dev-сервера).
const g = globalThis as unknown as {
  __demoRagRate?: { ips: Map<string, RateWindow>; total: RateWindow };
};
const rate = (g.__demoRagRate ??= { ips: new Map(), total: { count: 0, resetAt: 0 } });

function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

function rollWindow(w: RateWindow, now: number): void {
  if (now >= w.resetAt) {
    w.count = 0;
    w.resetAt = now + RATE_WINDOW_MS;
  }
}

// Все ответы демо — no-store (контракт §2).
function json(body: unknown, status: number, headers: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

function tooMany(retryAfterSec: number): NextResponse {
  return json(
    {
      ok: false,
      error: `Слишком много вопросов — попробуйте снова через ${Math.max(1, Math.ceil(retryAfterSec / 60))} мин.`,
      retryAfterSec,
    },
    429,
    { 'Retry-After': String(retryAfterSec) },
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  // --- Rate-limit до всего остального ---
  const now0 = Date.now();
  // Глобальный предохранитель — ДО создания per-IP-окна: запись в карте иначе
  // создаётся даже под 429, и спуфинг XFF надувает Map быстрее, чем её чистит
  // sweep (записи протухают только через 15 мин). Пока fuse сработал — короткий
  // 429 без записи; per-IP-проверка ниже остаётся первой для немобилизованных
  // окон, чтобы одиночный абьюзер не дожигал глобальный бюджет.
  rollWindow(rate.total, now0);
  if (rate.total.count > RATE_GLOBAL) {
    return tooMany(Math.max(1, Math.ceil((rate.total.resetAt - now0) / 1000)));
  }

  const ip = clientIp(req);
  // Sweep протухших окон: не даём карте расти бесконечно при спуфинге XFF.
  if (rate.ips.size > 500) {
    for (const [k, v] of rate.ips) {
      if (now0 >= v.resetAt) rate.ips.delete(k);
    }
  }
  let win = rate.ips.get(ip);
  if (!win) {
    win = { count: 0, resetAt: now0 + RATE_WINDOW_MS };
    rate.ips.set(ip, win);
  }
  rollWindow(win, now0);
  win.count += 1;
  if (win.count > RATE_PER_IP) {
    return tooMany(Math.max(1, Math.ceil((win.resetAt - now0) / 1000)));
  }

  rate.total.count += 1;
  if (rate.total.count > RATE_GLOBAL) {
    return tooMany(Math.max(1, Math.ceil((rate.total.resetAt - now0) / 1000)));
  }

  // --- Валидация входа (граница; не-JSON тело тоже 400) ---
  const parsed = demoRagSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return json({ ok: false, error: parsed.error.issues[0]?.message ?? 'invalid request' }, 400);
  }

  // --- Провайдеры фиксирует сервер: cloud → fallback local; ни один не настроен → 503 ---
  const keys = getKeysStatus();
  if (!keys.cloud.configured && !keys.local.configured) {
    return json(
      { ok: false, error: 'LLM не настроен ни локально, ни в облаке — демо временно недоступно.' },
      503,
    );
  }
  if (!keys.embed.configured) {
    return json(
      { ok: false, error: 'База знаний не настроена (эмбеддинги) — демо временно недоступно.' },
      503,
    );
  }
  const client = pickLlmClient(keys.cloud.configured ? 'cloud' : 'local');

  const question = clean(parsed.data.question, 300);

  // --- RAG по публичной партиции; abort 45 с ИЛИ дисконнект клиента (req.signal) ---
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  const onClientAbort = (): void => ac.abort();
  req.signal.addEventListener('abort', onClientAbort);
  try {
    const retriever = new Retriever(getRagStore(), makeEmbedder(), PUBLIC_STRATEGY);
    // withDb сериализует обращения к DatabaseSync (store.search синхронен и тяжёл),
    // как в /api/rag/query. 1-юзер локально: mutex на время LLM-вызова приемлем.
    const result = await withDb(() =>
      answerWithRag(client, retriever, question, { k: TOP_K, signal: ac.signal }),
    );

    const answer = clean(result.answer, MAX_ANSWER_LEN);
    // Страховочный фильтр (defense-in-depth): партиция 'structure' tg-чанк вернуть
    // не может в принципе, но любой источник с tg://|telegram в метаданных — дроп.
    // chunkId (= `${source}::${index}`) в haystack наравне с source: если формат
    // идентификатора когда-нибудь изменится, страховка не развалится.
    const sources = result.sources
      .filter((s) => {
        const m = s.chunk.metadata;
        const hay = `${m.source}\n${m.title}\n${m.section}\n${m.chunkId}`.toLowerCase();
        return !hay.includes('tg://') && !hay.includes('telegram');
      })
      .map((s, i) => ({
        n: i + 1,
        title: s.chunk.metadata.title,
        section: s.chunk.metadata.section,
        snippet: s.chunk.text.slice(0, SNIPPET_LEN),
        score: s.score,
      }));
    return json({ ok: true, answer, gaveUp: result.debug?.gaveUp ?? false, sources }, 200);
  } catch (e) {
    // Эмбеддер/LLM упали (Ollama лежит, сеть, таймаут) → честный 502, без
    // fallback-ответа «без базы». safeMessage чистит Bearer/URL/пути.
    const detail = e instanceof Error ? safeMessage(e.message) : 'rag failed';
    const error = ac.signal.aborted
      ? 'Время ожидания истекло — база знаний не успела ответить, попробуйте ещё раз.'
      : `База знаний временно недоступна (${detail}). Попробуйте позже.`;
    return json({ ok: false, error }, 502);
  } finally {
    clearTimeout(timer);
    req.signal.removeEventListener('abort', onClientAbort);
  }
}
