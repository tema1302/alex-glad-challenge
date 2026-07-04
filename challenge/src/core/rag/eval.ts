// Контрольные вопросы для оценки RAG (день 22, усиление; день 23 — A/B).
// 10 вопросов с ожиданием и (опционально) ожидаемыми источниками.
// Хранятся в src/data/rag-eval.json — пользователь редактирует под свой корпус.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { LlmClient } from '../client.js';
import { answerNoRag, answerWithRag, DEFAULT_RAG_THRESHOLD } from './rag.js';
import type { RagAnswer, RagOptions } from './rag.js';
import type { Retriever } from './retriever.js';
import { formatDuration } from './pipeline.js';

export interface EvalQuestion {
  id: number;
  q: string;
  expectation: string;
  sources?: string[];
  level?: string;          // день 24: broad → narrow градация вопроса
  expectedGuard?: boolean; // день 24: ожидаем, что сработает guard «не знаю»
}

export interface EvalRow {
  question: EvalQuestion;
  noRag: string;
  withRag: string;
  sources: { source: string; section: string; score: number }[];
}

export async function loadEval(file: string): Promise<EvalQuestion[]> {
  const raw = await readFile(file, 'utf8');
  return JSON.parse(raw) as EvalQuestion[];
}

export async function runEval(
  client: LlmClient,
  retriever: Retriever,
  questions: EvalQuestion[],
  k = 4,
): Promise<EvalRow[]> {
  const rows: EvalRow[] = [];
  const total = questions.length;
  const start = Date.now();
  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    const noRag = await answerNoRag(client, question.q);
    // pool по умолч. = k → поведение идентично дню 22 (retrieve(k) → filter → slice(k)).
    const { answer: withRag, sources } = await answerWithRag(client, retriever, question.q, { k });
    rows.push({
      question,
      noRag,
      withRag,
      sources: sources.map((s) => ({
        source: s.chunk.metadata.source,
        section: s.chunk.metadata.section,
        score: s.score,
      })),
    });
    // live-прогресс по контрольным вопросам (2 вызова LLM на каждый),
    // чтобы batch-eval не выглядел зависшим.
    const done = i + 1;
    const pct = total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 100;
    const elapsed = Date.now() - start;
    const rate = done > 0 ? elapsed / done : 0;
    const eta = rate * (total - done);
    console.log(`  [eval ${done}/${total} · ${pct}% · ~${formatDuration(eta)} left]`);
  }
  return rows;
}

// --- A/B (день 23): baseline (cosine-only) vs improved (+LLM rerank). ---

export interface EvalMetrics {
  coversSources: number;   // доля вопросов (с ожидаемыми sources), где все ожидаемые найдены
  meanScore: number;       // средний cosine-скор финальных источников
  keptAfterFilter: number; // среднее число чанков, прошедших cosine pre-filter
  avgRankDelta: number;    // средний сдвиг позиций после реранка (0 если реранк off)
  questions: number;
}

export interface EvalAbRow {
  question: EvalQuestion;
  baseline: RagAnswer;     // threshold=0.5, rerank OFF, rewrite OFF
  improved: RagAnswer;     // threshold=0.5, rerank ON
}

export interface EvalAbResult {
  baseline: EvalMetrics;
  improved: EvalMetrics;
  perQuestion: EvalAbRow[];
}

export async function runEvalAB(
  client: LlmClient,
  retriever: Retriever,
  questions: EvalQuestion[],
  opts: { k?: number; pool?: number; threshold?: number } = {},
): Promise<EvalAbResult> {
  const k = opts.k ?? 4;
  const pool = opts.pool ?? 20;
  const threshold = opts.threshold ?? DEFAULT_RAG_THRESHOLD;
  const total = questions.length;
  const start = Date.now();

  const perQuestion: EvalAbRow[] = [];
  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    const baseline = await answerWithRag(client, retriever, question.q, {
      k,
      pool,
      threshold,
      rerank: false,
      rewrite: false,
    });
    const improved = await answerWithRag(client, retriever, question.q, {
      k,
      pool,
      threshold,
      rerank: true,
      rewrite: false,
    });
    perQuestion.push({ question, baseline, improved });

    const done = i + 1;
    const pct = total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 100;
    const elapsed = Date.now() - start;
    // 3 LLM-вызова на вопрос (retrieve-embed + 2× answer), плюс rerank-вызов в improved.
    const rate = done > 0 ? elapsed / done : 0;
    const eta = rate * (total - done);
    console.log(`  [eval A/B ${done}/${total} · ${pct}% · ~${formatDuration(eta)} left]`);
  }

  return {
    baseline: computeMetrics(perQuestion.map((r) => ({ question: r.question, answer: r.baseline }))),
    improved: computeMetrics(perQuestion.map((r) => ({ question: r.question, answer: r.improved }))),
    perQuestion,
  };
}

// Метрики строго из RagAnswer.debug и sources — БЕЗ LLM-judge (медленно + циркулярно).
// coversSources: вопросы без ожидаемых sources исключаются и из числителя, и из знаменателя.
function computeMetrics(rows: { question: EvalQuestion; answer: RagAnswer }[]): EvalMetrics {
  const questions = rows.length;
  if (questions === 0) {
    return { coversSources: 0, meanScore: 0, keptAfterFilter: 0, avgRankDelta: 0, questions: 0 };
  }
  let covered = 0;
  let withSources = 0;
  let scoreSum = 0;
  let scoreCount = 0;
  let filterSum = 0;
  let deltaSum = 0;
  for (const r of rows) {
    const retrievedSources = new Set(r.answer.sources.map((s) => s.chunk.metadata.source));
    if (r.question.sources && r.question.sources.length > 0) {
      withSources++;
      const hit = r.question.sources.every((src) => retrievedSources.has(src));
      if (hit) covered++;
    }
    for (const s of r.answer.sources) {
      scoreSum += s.score;
      scoreCount++;
    }
    filterSum += r.answer.debug?.filteredSize ?? 0;
    deltaSum += r.answer.debug?.rankDelta ?? 0;
  }
  return {
    coversSources: withSources > 0 ? covered / withSources : 0,
    meanScore: scoreCount > 0 ? scoreSum / scoreCount : 0,
    keptAfterFilter: filterSum / questions,
    avgRankDelta: deltaSum / questions,
    questions,
  };
}

// --- День 24: метрики наличия источников/цитат/guard'а (pure, без LLM-judge). ---
// «Совпадает ли смысл ответа с цитатами» — ручная сверка в финальном Report;
// здесь только структурные доли. Образец — computeMetrics выше.
export interface Day24Metrics {
  questions: number;
  sourcesCoverage: number;         // доля ответов с sources.length > 0
  quotesCoverage: number;          // доля ответов с (quotes?.length ?? 0) > 0
  guardTriggered: number;          // доля ответов с debug?.gaveUp === true
  answerHasCitationMarker: number; // доля ответов, где /\[\d+\]/.test(answer)
}

export function computeDay24Metrics(rows: { answer: RagAnswer }[]): Day24Metrics {
  const questions = rows.length;
  if (questions === 0) {
    return {
      questions: 0,
      sourcesCoverage: 0,
      quotesCoverage: 0,
      guardTriggered: 0,
      answerHasCitationMarker: 0,
    };
  }
  let withSources = 0;
  let withQuotes = 0;
  let guardCount = 0;
  let markerCount = 0;
  for (const r of rows) {
    if (r.answer.sources.length > 0) withSources++;
    if ((r.answer.quotes?.length ?? 0) > 0) withQuotes++;
    if (r.answer.debug?.gaveUp === true) guardCount++;
    if (/\[\d+\]/.test(r.answer.answer)) markerCount++;
  }
  return {
    questions,
    sourcesCoverage: withSources / questions,
    quotesCoverage: withQuotes / questions,
    guardTriggered: guardCount / questions,
    answerHasCitationMarker: markerCount / questions,
  };
}

// --- День 24: живой раннер 10 вопросов broad→narrow (structural metrics, без LLM-judge). ---
// Образец — runEvalAB: тот же live-прогресс по вопросам, но ОДИН прогон (не A/B) и финальные
// метрики — computeDay24Metrics (sources/quotes/guard/citation-marker). Прогон запускает
// ОПЕРАТОР (нужны Ollama + собранный индекс); 10q грузится из src/data/rag-eval-day24.json.
// Раннер НЕ рендерит построчный отчёт (это задача CLI-слоя) — только live-строку прогресса
// внутри цикла, как runEval/runEvalAB. Stage-прогресс (RagStage) прокидывается через
// opts.onProgress в answerWithRag как обычно.
export async function runEvalDay24(
  client: LlmClient,
  retriever: Retriever,
  opts: RagOptions = {},
): Promise<{ rows: { question: EvalQuestion; answer: RagAnswer }[]; metrics: Day24Metrics }> {
  const file = path.join(process.cwd(), 'src', 'data', 'rag-eval-day24.json');
  const questions = await loadEval(file);
  const total = questions.length;
  const start = Date.now();
  const rows: { question: EvalQuestion; answer: RagAnswer }[] = [];
  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    const answer = await answerWithRag(client, retriever, question.q, opts);
    rows.push({ question, answer });
    const done = i + 1;
    const pct = total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 100;
    const elapsed = Date.now() - start;
    const rate = done > 0 ? elapsed / done : 0;
    const eta = rate * (total - done);
    console.log(`  [eval day24 ${done}/${total} · ${pct}% · ~${formatDuration(eta)} left]`);
  }
  const metrics = computeDay24Metrics(rows.map((r) => ({ answer: r.answer })));
  return { rows, metrics };
}
