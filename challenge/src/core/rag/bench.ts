// День 29. Бенчмарк RAG-ответов: before/after по одному корпусу вопросов.
//
// runBench прогоняет список вопросов через answerWithRag (один прогон = один набор
// RagOptions), собирает из answer.debug.llmUsage/llmTimings метрики скорости/латентности
// и из ответа/gaveUp — структурные доли + guard-recall. Никаких LLM-judge: «смысл = цитаты»
// сверяется вручную (manual-review блок в day-29).
//
// Замеряем только non-stream path (answerWithRag без onToken), где есть timings.
// bench идёт в одном режиме (non-stream) — stream-ветка timings не заполняет.

import type { LlmClient } from '../client.js';
import type { Retriever } from './retriever.js';
import type { EvalQuestion } from './eval.js';
import { computeDay24Metrics } from './eval.js';
import type { Day24Metrics } from './eval.js';
import type { RagAnswer, RagOptions } from './rag.js';
import { answerWithRag } from './rag.js';
import { formatDuration } from './pipeline.js';

export interface BenchSample {
  question: EvalQuestion;
  answer: RagAnswer;
}

export interface BenchSummary {
  label: string;
  samples: BenchSample[];
  // Скорость генерации: sum(completion_tokens) / (sum(evalMs)/1000), только по
  // вопросам, где LLM звался (gaveUp===false). 0, если нет evalMs.
  tokensPerSec: number;
  latencyP50Ms: number;  // медиана totalMs по gaveUp===false
  latencyMeanMs: number; // среднее totalMs по gaveUp===false
  promptTokens: number;  // sum(prompt_tokens) по gaveUp===false
  genTokens: number;     // sum(completion_tokens) по gaveUp===false
  llmCalls: number;      // число вопросов с gaveUp===false (LLM звался)
  guardShortCircuit: number; // число вопросов с debug.gaveUp===true (decideGuard)
  // Guard recall на expectedGuard=true: доля вопросов, где итоговый ответ = «не знаю»
  // (decideGuard gaveUp===true ИЛИ LLM-ответ содержит noKnow-фразу). Два уровня guard'а:
  // для плотного TG-корпуса cosine threshold 0.5 редко даёт пустой filtered (темы
  // обсуждаются), поэтому решающий вклад вносит LLM-level guard (system-prompt).
  guardRecall: number;
  structural: Day24Metrics;
}

export async function runBench(
  client: LlmClient,
  retriever: Retriever,
  questions: EvalQuestion[],
  opts: RagOptions & { label: string },
  onProgress?: (done: number, total: number, q: EvalQuestion, answer: RagAnswer) => void,
): Promise<BenchSummary> {
  const samples: BenchSample[] = [];
  const start = Date.now();
  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    const answer = await answerWithRag(client, retriever, question.q, opts);
    samples.push({ question, answer });
    onProgress?.(i + 1, questions.length, question, answer);
    const done = i + 1;
    const total = questions.length;
    const elapsed = Date.now() - start;
    const rate = done > 0 ? elapsed / done : 0;
    const eta = rate * (total - done);
    console.log(`  [bench ${done}/${total} · ~${formatDuration(eta)} left] q${question.id} gaveUp=${answer.debug?.gaveUp === true}`);
  }
  return summarize(opts.label, samples);
}

// Детектор LLM-level «не знаю»: ответ guard'а или явная фраза отказа. Для TG-корпуса,
// где decideGuard (cosine) редко отсеивает обсуждаемые темы, это основной сигнал guard'а.
function isNoKnowAnswer(answer: string): boolean {
  const t = answer.toLowerCase();
  return (
    t.includes('не знаю') ||
    t.includes('нет точного ответа') ||
    t.includes('нет релевантного') ||
    t.includes('не могу') ||
    t.includes('в базе нет')
  );
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function summarize(label: string, samples: BenchSample[]): BenchSummary {
  const llmSamples = samples.filter((s) => s.answer.debug?.gaveUp === false);
  let evalCount = 0;
  let promptCount = 0;
  let evalMs = 0;
  const latencies: number[] = [];
  for (const s of llmSamples) {
    const u = s.answer.debug?.llmUsage;
    const t = s.answer.debug?.llmTimings;
    if (u) {
      evalCount += u.completion_tokens;
      promptCount += u.prompt_tokens;
    }
    if (t) {
      evalMs += t.evalMs;
      latencies.push(t.totalMs);
    }
  }
  const tokensPerSec = evalMs > 0 ? evalCount / (evalMs / 1000) : 0;
  const latencyMeanMs = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;

  const guardQs = samples.filter((s) => s.question.expectedGuard === true);
  const guardHits = guardQs.filter(
    (s) => s.answer.debug?.gaveUp === true || isNoKnowAnswer(s.answer.answer),
  ).length;
  const guardRecall = guardQs.length > 0 ? guardHits / guardQs.length : 0;

  return {
    label,
    samples,
    tokensPerSec,
    latencyP50Ms: median(latencies),
    latencyMeanMs,
    promptTokens: promptCount,
    genTokens: evalCount,
    llmCalls: llmSamples.length,
    guardShortCircuit: samples.filter((s) => s.answer.debug?.gaveUp === true).length,
    guardRecall,
    structural: computeDay24Metrics(samples.map((s) => ({ answer: s.answer }))),
  };
}
