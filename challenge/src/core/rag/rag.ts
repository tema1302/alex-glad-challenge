// RAG-агент (день 22→23): два режима — с RAG (контекст из индекса) и без RAG (общие знания).
// LLM — строго локальная (makeLocalLlmClient).
//
// День 23: пайплайн расширен опциональными стадиями:
//   rewrite? → retrieve(pool) → filterByThreshold(threshold) → rerank? → slice(topK)
//     → buildRagPrompt(ИСХОДНЫЙ question, ranked) → chat
// При отсутствии опций поведение идентично дню 22 (threshold=0.5, pool=k, rerank off,
// rewrite off): retrieve(k) → filter(0.5) → slice(k) → prompt.

import type { LlmClient } from '../client.js';
import { msg } from '../types.js';
import type { Quote, ScoredChunk } from './types.js';
import type { Retriever } from './retriever.js';
import { rerankWithLlm } from './rerank.js';
import { rewriteQuery } from './rewrite.js';
import { extractQuotes } from './quotes.js';

// Фиксация языка вынесена в НАЧАЛО промпта: qwen2.5:7b-instruct склонен дрейфить
// в zh, короткой фразы в конце недостаточно. Явный запрет доп. языков обязателен.
const SYSTEM_RAG =
  'Отвечай ТОЛЬКО на русском языке. Использовать китайский и любые другие языки запрещено. ' +
  'Ты — ассистент с базой знаний. Отвечай на вопрос СТРОГО по предоставленному контексту. ' +
  'Если в контексте нет ответа — так и скажи: «в базе нет точного ответа». ' +
  'Цитируй источники в виде [n], ссылаясь на номер фрагмента.';

const SYSTEM_NO_RAG =
  'Отвечай ТОЛЬКО на русском языке. Использовать китайский и любые другие языки запрещено. ' +
  'Ты — ассистент. Отвечай из общих знаний, без внешнего контекста.';

// Минимальный косинусный скор чанка для попадания в промпт. Подобран так, чтобы
// не обрезать валидные совпадения (0.7+), но отсечь шум ретривера (топ-K всегда
// что-то вернёт, даже для нерелевантного запроса). День 23: вынесен в экспорт,
// переопределяется через RagOptions.threshold.
export const DEFAULT_RAG_THRESHOLD = 0.5;

// Фиксированный ответ guard'а «не знаю» (день 24). Возвращается БЕЗ вызова LLM,
// когда retrieve ничего не дал после cosine pre-filter (filtered.length === 0)
// или когда лучший скор ниже opts.minScore (default-off, включается через --floor).
// Детерминированный шорт-кёркт гасит галлюцинации qwen2.5:7b на пустом/слабом контексте.
export const GUARD_ANSWER =
  'Не знаю. В базе знаний нет релевантного фрагмента по этому вопросу. ' +
  'Уточните вопрос — например, укажите раздел или особенность автомобиля EVOLUTE i-SPACE.';

// buildRagPrompt принимает УЖЕ отфильтрованные чанки. Повторной фильтрации нет:
// фильтрация — отдельная стадия пайплайна (filterByThreshold), чтобы порог был
// виден и настраиваем. При пустом массиве — ветка «нет релевантных».
export function buildRagPrompt(question: string, chunks: ScoredChunk[]) {
  if (chunks.length === 0) {
    return [
      msg.system(SYSTEM_RAG),
      msg.user(`В базе знаний нет релевантных фрагментов по этому вопросу.\n\nВопрос: ${question}`),
    ];
  }
  const ctx = chunks
    .map((c, i) => {
      const m = c.chunk.metadata;
      return `[${i + 1}] source=${m.source} | section=${m.section} | score=${c.score.toFixed(3)}\n${c.chunk.text}`;
    })
    .join('\n\n---\n\n');
  return [
    msg.system(SYSTEM_RAG),
    msg.user(`Контекст из базы знаний:\n${ctx}\n\nВопрос: ${question}`),
  ];
}

// Фильтрация по порогу: отдельная стадия (день 23), раньше была спрятана внутри
// buildRagPrompt. Экспортирована — используется и в пайплайне, и в метриках eval.
export function filterByThreshold(chunks: ScoredChunk[], threshold: number): ScoredChunk[] {
  return chunks.filter((c) => c.score >= threshold);
}

// Guard «не знаю» (день 24): детерминированное решение, отказаться ли от LLM-вызова
// при пустом/слабом контексте. Pure-функция, не зовёт ни сеть, ни модель.
//   - empty: filtered.length === 0 (всё отсеялось порогом threshold).
//   - floor: opts.minScore задан и лучший скор ниже него (опц. закалка, default-off).
// store.search сортирует по убыванию score, поэтому filtered[0] — топ-1 (store.ts:131).
export function decideGuard(
  filtered: ScoredChunk[],
  minScore?: number,
): { gaveUp: boolean; reason?: 'empty' | 'floor'; maxScore: number } {
  const maxScore = filtered.length > 0 ? filtered[0].score : 0;
  if (filtered.length === 0) {
    return { gaveUp: true, reason: 'empty', maxScore: 0 };
  }
  if (minScore !== undefined && maxScore < minScore) {
    return { gaveUp: true, reason: 'floor', maxScore };
  }
  return { gaveUp: false, maxScore };
}

export interface RagDebug {
  poolSize: number;        // сколько достали из индекса (candidate pool)
  filteredSize: number;    // сколько прошло cosine pre-filter
  threshold: number;
  rerankApplied: boolean;
  fallback: boolean;       // реранкер не дал валидного ответа → cosine-порядок
  rankDelta: number;       // средний сдвиг позиций после реранка
  rewritten: boolean;      // был ли переформулирован запрос
  effectiveQuery?: string; // переформулированный запрос (если rewrite сработал)
  gaveUp?: boolean;        // день 24: сработал ли guard «не знаю» без LLM-вызова
}

export interface RagAnswer {
  answer: string;
  sources: ScoredChunk[]; // финальные чанки, попавшие в промпт (filtered/ranked)
  quotes?: Quote[];       // день 24: детерминированные цитаты из sources (без LLM)
  debug?: RagDebug;
}

export type RagStage =
  | { step: 'rewrite'; detail: { original: string; rewritten: string } }
  | { step: 'retrieve'; detail: { query: string; pool: number } }
  | { step: 'filter'; detail: { before: number; after: number; threshold: number } }
  | { step: 'rerank'; detail: { before: number; after: number; fallback: boolean; rankDelta: number } }
  | { step: 'guard'; detail: { reason: 'empty' | 'floor'; filteredSize: number; maxScore: number } }
  | { step: 'llm'; detail: { topK: number } };

export interface RagOptions {
  k?: number;          // финальное число чанков (topK после фильтра/реранка)
  pool?: number;       // сколько достать из индекса (candidate pool); по умолч. = k
  threshold?: number;  // косинусный pre-filter; по умолч. DEFAULT_RAG_THRESHOLD
  rerank?: boolean;    // LLM-reranker on/off (по умолч. off — совместимость с днём 22)
  rewrite?: boolean;   // query rewrite on/off (по умолч. off)
  minScore?: number;   // день 24: опц. floor лучшего скора для guard'а (default-off)
  onProgress?: (stage: RagStage) => void;
}

export async function answerWithRag(
  client: LlmClient,
  retriever: Retriever,
  question: string,
  opts: RagOptions = {},
): Promise<RagAnswer> {
  const k = opts.k ?? 4;
  const pool = opts.pool ?? k; // по умолч. pool=k → поведение идентично дню 22
  const threshold = opts.threshold ?? DEFAULT_RAG_THRESHOLD;
  const useRerank = opts.rerank ?? false;
  const useRewrite = opts.rewrite ?? false;
  const onProgress = opts.onProgress;

  // 1. Опциональный query rewrite. В retrieve идёт переформулированный запрос,
  //    но в финальный промпт — ИСХОДНЫЙ вопрос (rewrite только расширяет поиск).
  let effectiveQuery = question;
  let rewritten = false;
  if (useRewrite) {
    const rewrittenQuery = await rewriteQuery(client, question);
    rewritten = rewrittenQuery !== question;
    effectiveQuery = rewrittenQuery;
    onProgress?.({ step: 'rewrite', detail: { original: question, rewritten: effectiveQuery } });
  }

  // 2. retrieve(pool): candidate pool шире финального topK — реранкеру/фильтру
  //    нужно из чего выбирать. store.search и так сканирует все row'ы стратегии,
  //    больший pool не добавляет стоимости сканирования.
  const candidates = await retriever.retrieve(effectiveQuery, pool);
  onProgress?.({ step: 'retrieve', detail: { query: effectiveQuery, pool: candidates.length } });

  // 3. cosine pre-filter по порогу.
  const filtered = filterByThreshold(candidates, threshold);
  onProgress?.({
    step: 'filter',
    detail: { before: candidates.length, after: filtered.length, threshold },
  });

  // 3.5 (день 24). Guard «не знаю»: если после cosine pre-filter контекст пуст
  //    или лучший скор ниже opts.minScore — возвращаем фиксированный ответ БЕЗ
  //    вызова LLM. Шорт-кёркт гасит галлюцинации qwen2.5:7b на пустом/слабом
  //    контексте. minScore default-off → guard работает только по empty.
  const guard = decideGuard(filtered, opts.minScore);
  if (guard.gaveUp) {
    onProgress?.({
      step: 'guard',
      detail: {
        reason: guard.reason ?? 'empty',
        filteredSize: filtered.length,
        maxScore: guard.maxScore,
      },
    });
    return {
      answer: GUARD_ANSWER,
      sources: [],
      quotes: [],
      debug: {
        poolSize: candidates.length,
        filteredSize: filtered.length,
        threshold,
        rerankApplied: useRerank,
        fallback: false,
        rankDelta: 0,
        rewritten,
        effectiveQuery: rewritten ? effectiveQuery : undefined,
        gaveUp: true,
      },
    };
  }

  // 4. Опциональный LLM-reranker → topK. Без реранка — просто slice(topK).
  let ranked: ScoredChunk[];
  let fallback = false;
  let rankDelta = 0;
  if (useRerank) {
    const r = await rerankWithLlm(client, question, filtered, k);
    ranked = r.ranked;
    fallback = r.fallback;
    rankDelta = r.rankDelta;
    onProgress?.({
      step: 'rerank',
      detail: { before: filtered.length, after: ranked.length, fallback, rankDelta },
    });
  } else {
    ranked = filtered.slice(0, k);
  }

  // 5. Финальный LLM-ответ. onProgress сообщает итоговый topK до вызова.
  onProgress?.({ step: 'llm', detail: { topK: ranked.length } });
  const answer = await client.chat(buildRagPrompt(question, ranked));

  return {
    answer,
    sources: ranked,
    quotes: extractQuotes(ranked, question),
    debug: {
      poolSize: candidates.length,
      filteredSize: filtered.length,
      threshold,
      rerankApplied: useRerank,
      fallback,
      rankDelta,
      rewritten,
      effectiveQuery: rewritten ? effectiveQuery : undefined,
      gaveUp: false,
    },
  };
}

export async function answerNoRag(client: LlmClient, question: string): Promise<string> {
  return client.chat([msg.system(SYSTEM_NO_RAG), msg.user(question)]);
}
