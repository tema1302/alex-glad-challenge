// День 29. Оптимизация локальной LLM для RAG-ответов по TG/RSS.
//
// Цель: сравнить baseline (Ollama-дефолты, дефолтный SYSTEM_RAG) vs optimized
// (params {temperature:0.2, maxTokens:640, numCtx:4096, seed:42} + TG_RAG_SYSTEM) на
// одном корпусе вопросов по telegram-партиции. Метрики: tok/s, latency p50/mean,
// prompt/gen tokens, guard recall, структурные доли (sources/quotes/citation), VRAM.
//
// ДВА сквозных прогона через единый харнес runBench: те же 14 вопросов, тот же
// retriever (strategy='telegram', k=4, pool=20, threshold=0.5), та же модель.
// think:false НЕ трогается (хардкод llm.ts). Индекс .data/rag.sqlite — READ-ONLY
// (только count/search; без INSERT/DELETE/clear/reindex).
//
// Датасет + knobs заморожены ДО подбора (anti-cherry-picking): rag-eval-day29.json.
// «Смысл = цитаты» сверяется вручную (manual-review блок); автоматика — структурная.
//
// Запуск:
//   pnpm --filter challenge start -- day-29

import path from 'node:path';

import { dataPath } from '../core/paths.js';
import type { ChatParams } from '../core/types.js';
import {
  RagStore,
  Retriever,
  makeEmbedder,
  makeLocalLlmClient,
  loadEval,
  runBench,
  detectHardware,
  DEFAULT_RAG_THRESHOLD,
} from '../core/rag/index.js';
import type { BenchSummary, HardwareInfo } from '../core/rag/index.js';
import type { Demo } from './types.js';

const RAG_DB_PATH = dataPath('rag.sqlite');
const EVAL_FILE = path.join(process.cwd(), 'src', 'data', 'rag-eval-day29.json');
const STRATEGY = 'telegram' as const;
const TOP_K = 4;
const POOL = 20;
const THRESHOLD = DEFAULT_RAG_THRESHOLD;

// Optimized knobs (минимальный набор = 4). baseline — НЕ передаётся (Ollama-дефолты:
// temp≈0.8, num_ctx=2048, seed random; num_predict=1024 по client default).
const KNOBS_OPTIMIZED: ChatParams = {
  temperature: 0.2,
  maxTokens: 640,
  numCtx: 4096,
  seed: 42,
};

// System-prompt под TG/RSS: явно фиксирует природу контекста (мнения/опыт владельцев,
// НЕ официальная спецификация) и запрет выдумывать факты. Передаётся в buildRagPrompt
// через opts.systemPrompt (additive override, SYSTEM_RAG не меняется).
const TG_RAG_SYSTEM =
  'Отвечай ТОЛЬКО на русском языке. Другие языки запрещены. ' +
  'Контекст — это сообщения Telegram-чата владельцев автомобиля (мнения и опыт, ' +
  'а НЕ официальная спецификация). Отвечай СТРОГО по этому контексту. ' +
  'Если в контексте нет точного ответа — так и скажи: «в базе нет точного ответа». ' +
  'Ссылайся на фрагменты в виде [n]. Не выдумывай фактов, которых нет в контексте.';

function truncate(s: string, max = 240): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max) + '…' : clean;
}

function fmtNum(x: number, digits = 0): string {
  if (!Number.isFinite(x)) return '-';
  return digits > 0 ? x.toFixed(digits) : String(Math.round(x));
}

function fmtBytes(n: number | undefined): string {
  if (n == null) return 'n/a';
  return `${(n / 1024 / 1024).toFixed(0)} MB`;
}

function printHardware(label: string, hw: HardwareInfo): void {
  console.log(`Железо [${label}]:`);
  console.log(`  CPU:     ${hw.cpuModel} (${hw.cpuCores} ядер)`);
  console.log(`  runtime: ${hw.llmRuntime}`);
  console.log(`  GPU:     ${hw.gpu ?? 'не определено'} [source: ${hw.source}]`);
  console.log(`  model:   size=${fmtBytes(hw.modelSizeBytes)}, vram=${fmtBytes(hw.modelVramBytes)}`);
  console.log('');
}

// Таблица метрик before/after. Δ считается для сравнения.
function printCompareTable(b: BenchSummary, o: BenchSummary): void {
  console.log(`\n${'='.repeat(72)}`);
  console.log('Сравнение baseline vs optimized');
  console.log('='.repeat(72));
  const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;
  const rows: { name: string; bv: string; ov: string; delta?: string }[] = [
    { name: 'tok/s', bv: fmtNum(b.tokensPerSec, 1), ov: fmtNum(o.tokensPerSec, 1), delta: fmtDelta(o.tokensPerSec - b.tokensPerSec, 1) },
    { name: 'latency p50 (ms)', bv: fmtNum(b.latencyP50Ms), ov: fmtNum(o.latencyP50Ms), delta: fmtDelta(o.latencyP50Ms - b.latencyP50Ms) },
    { name: 'latency mean (ms)', bv: fmtNum(b.latencyMeanMs), ov: fmtNum(o.latencyMeanMs), delta: fmtDelta(o.latencyMeanMs - b.latencyMeanMs) },
    { name: 'prompt tokens (sum)', bv: fmtNum(b.promptTokens), ov: fmtNum(o.promptTokens) },
    { name: 'gen tokens (sum)', bv: fmtNum(b.genTokens), ov: fmtNum(o.genTokens) },
    { name: 'llm calls', bv: fmtNum(b.llmCalls), ov: fmtNum(o.llmCalls) },
    { name: 'guard short-circuit (gaveUp)', bv: fmtNum(b.guardShortCircuit), ov: fmtNum(o.guardShortCircuit) },
    { name: 'guard recall (on expectedGuard)', bv: pct(b.guardRecall), ov: pct(o.guardRecall) },
    { name: 'sourcesCoverage (struct)', bv: pct(b.structural.sourcesCoverage), ov: pct(o.structural.sourcesCoverage) },
    { name: 'quotesCoverage (struct)', bv: pct(b.structural.quotesCoverage), ov: pct(o.structural.quotesCoverage) },
    { name: 'citation marker (struct)', bv: pct(b.structural.answerHasCitationMarker), ov: pct(o.structural.answerHasCitationMarker) },
  ];
  console.log('  metric                          | baseline  | optimized |     Δ');
  console.log('  --------------------------------|-----------|-----------|------');
  for (const r of rows) {
    console.log(
      `  ${r.name.padEnd(31)} | ${r.bv.padStart(9)} | ${r.ov.padStart(9)} | ${(r.delta ?? '').padStart(5)}`,
    );
  }
  console.log(`  всего вопросов: ${b.samples.length} (answerable=${b.samples.filter((s) => !s.question.expectedGuard).length}, expectedGuard=${b.samples.filter((s) => s.question.expectedGuard).length})`);
}

function fmtDelta(d: number, digits = 0): string {
  if (!Number.isFinite(d)) return '';
  const sign = d > 0 ? '+' : '';
  return `${sign}${digits > 0 ? d.toFixed(digits) : String(Math.round(d))}`;
}

// Ручная сверка ответов (бинарка «смысл = ожидание/цитаты» — оператор).
function printManualReview(b: BenchSummary, o: BenchSummary): void {
  console.log(`\n${'='.repeat(72)}`);
  console.log('Manual review (сверка ответов вручную)');
  console.log('='.repeat(72));
  for (let i = 0; i < b.samples.length; i++) {
    const bs = b.samples[i];
    const os = o.samples[i];
    const guard = bs.question.expectedGuard ? ' · expectedGuard' : '';
    console.log(`\nq${bs.question.id} [${bs.question.level ?? '-'}${guard}]: ${bs.question.q}`);
    console.log(`  ожидание:  ${truncate(bs.question.expectation, 200)}`);
    console.log(`  baseline:  ${truncate(bs.answer.answer)}`);
    console.log(`  optimized: ${truncate(os.answer.answer)}`);
  }
}

function printVramNote(before: HardwareInfo, after: HardwareInfo): void {
  console.log(`\n${'='.repeat(72)}`);
  console.log('VRAM-нота (num_ctx 2048 → 4096)');
  console.log('='.repeat(72));
  console.log(`  model size (before): ${fmtBytes(before.modelSizeBytes)}`);
  console.log(`  model size (after):  ${fmtBytes(after.modelSizeBytes)}`);
  console.log(`  VRAM       (before): ${fmtBytes(before.modelVramBytes)}`);
  console.log(`  VRAM       (after):  ${fmtBytes(after.modelVramBytes)}`);
  console.log(`  note: num_ctx 2048→4096 — единственный ресурсный эффект оптимизации`);
  console.log(`        (больше KV-cache). Ollama грузит модель в VRAM при первом запросе.`);
}

async function run(): Promise<void> {
  console.log('▶ День 29: оптимизация локальной LLM (RAG по TG/RSS)');
  console.log(`  индекс:     ${RAG_DB_PATH} (read-only)`);
  console.log(`  вопросы:    ${EVAL_FILE} (14 frozen)`);
  console.log(`  стратегия:  ${STRATEGY}`);
  console.log(`  retrieval:  k=${TOP_K}, pool=${POOL}, threshold=${THRESHOLD}`);
  console.log(`  knobs opt:  temp=${KNOBS_OPTIMIZED.temperature}, num_predict=${KNOBS_OPTIMIZED.maxTokens}, num_ctx=${KNOBS_OPTIMIZED.numCtx}, seed=${KNOBS_OPTIMIZED.seed}`);
  console.log('');

  const hwBefore = await detectHardware();
  printHardware('before', hwBefore);

  const client = makeLocalLlmClient();
  const store = new RagStore(RAG_DB_PATH);
  try {
    const count = store.count(STRATEGY);
    if (count === 0) {
      console.error(`Индекс пуст для стратегии "${STRATEGY}". Сначала проиндексируйте TG-чат (day-26/rag-cli-chat).`);
      return;
    }
    console.log(`Чанков в индексе (${STRATEGY}): ${count}\n`);

    const embedder = makeEmbedder();
    const retriever = new Retriever(store, embedder, STRATEGY);
    const questions = await loadEval(EVAL_FILE);

    const baseOpts = { k: TOP_K, pool: POOL, threshold: THRESHOLD };
    const optOpts = { ...baseOpts, llmParams: KNOBS_OPTIMIZED, systemPrompt: TG_RAG_SYSTEM };

    console.log(`${'='.repeat(72)}`);
    console.log('Прогон 1/2: baseline (без knobs, дефолтный SYSTEM_RAG)');
    console.log('='.repeat(72));
    const baseline = await runBench(client, retriever, questions, { ...baseOpts, label: 'baseline' });

    console.log(`\n${'='.repeat(72)}`);
    console.log('Прогон 2/2: optimized (knobs + TG_RAG_SYSTEM)');
    console.log('='.repeat(72));
    const optimized = await runBench(client, retriever, questions, { ...optOpts, label: 'optimized' });

    const hwAfter = await detectHardware();
    printHardware('after', hwAfter);

    printCompareTable(baseline, optimized);
    printManualReview(baseline, optimized);
    printVramNote(hwBefore, hwAfter);

    console.log(`\n${'='.repeat(72)}`);
    console.log('Готово: день 29. Индекс не изменён, think:false не тронут.');
  } finally {
    store.close();
  }
}

export const demo: Demo = {
  id: 'day-29',
  title: 'Оптимизация локальной LLM для RAG (params + prompt, bench before/after)',
  run,
};
