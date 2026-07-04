// День 23. Реранкинг и фильтрация RAG.
//
// Второй этап пайплайна: cosine retrieve (candidate pool) → фильтр по порогу →
// LLM-reranker → финальный top-K. Плюс опциональный query rewrite.
// Сравнение: baseline (cosine-only, день 22) vs improved (+LLM rerank).
//
// ВАЖНО: индекс НЕ реиндексируется. Только read-only retrieve + LLM. День 21+
// работает строго на локальных моделях (LOCAL_LLM_* / LOCAL_EMBED_*).
//
// Запуск:
//   pnpm --filter challenge start -- day-23
//   RAG_STRATEGY=structure pnpm --filter challenge start -- day-23

import path from 'node:path';

import {
  RagStore,
  Retriever,
  makeEmbedder,
  makeLocalLlmClient,
  loadEval,
  runEvalAB,
  detectHardware,
  answerWithRag,
  DEFAULT_RAG_THRESHOLD,
} from '../core/rag/index.js';
import type { ChunkingStrategy, RagStage, EvalAbResult, EvalQuestion } from '../core/rag/index.js';
import type { Demo } from './types.js';

const DB_PATH = path.join(process.cwd(), '.data', 'rag.sqlite');
const EVAL_FILE = path.join(process.cwd(), 'src', 'data', 'rag-eval.json');
const DEMO_IDS = [11, 12, 13, 14, 15];
const POOL = 20;
const TOP_K = 4;
const THRESHOLD = DEFAULT_RAG_THRESHOLD;

function truncate(s: string, max = 320): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max) + '…' : clean;
}

// Поэтапная печать стадий пайплайна через onProgress.
function printStage(stage: RagStage): void {
  if (stage.step === 'rewrite') {
    console.log(`  [1 · rewrite] "${truncate(stage.detail.original, 70)}" → "${truncate(stage.detail.rewritten, 70)}"`);
  } else if (stage.step === 'retrieve') {
    console.log(`  [2 · retrieve] pool=${stage.detail.pool}`);
  } else if (stage.step === 'filter') {
    console.log(`  [3 · filter] ${stage.detail.before} → ${stage.detail.after} (threshold=${stage.detail.threshold})`);
  } else if (stage.step === 'rerank') {
    console.log(
      `  [4 · rerank] ${stage.detail.before} → ${stage.detail.after} (fallback=${stage.detail.fallback}, Δrank=${stage.detail.rankDelta.toFixed(2)})`,
    );
  } else if (stage.step === 'llm') {
    console.log(`  [5 · llm] topK=${stage.detail.topK}`);
  }
}

function fmt(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(3);
}

function printAbTable(result: EvalAbResult): void {
  console.log(`\n=== A/B: baseline (cosine-only) vs improved (+LLM rerank) ===`);
  const metrics: [string, number, number][] = [
    ['coversSources', result.baseline.coversSources, result.improved.coversSources],
    ['meanScore', result.baseline.meanScore, result.improved.meanScore],
    ['keptAfterFilter', result.baseline.keptAfterFilter, result.improved.keptAfterFilter],
    ['avgRankDelta', result.baseline.avgRankDelta, result.improved.avgRankDelta],
    ['questions', result.baseline.questions, result.improved.questions],
  ];
  console.log('  metric            | baseline | improved |     Δ');
  console.log('  ------------------|----------|----------|------');
  for (const [name, b, im] of metrics) {
    const d = im - b;
    const sign = d > 0 ? '+' : '';
    const dv = Number.isInteger(d) ? `${sign}${d}` : `${sign}${d.toFixed(3)}`;
    console.log(`  ${name.padEnd(18)} | ${fmt(b).padStart(8)} | ${fmt(im).padStart(8)} | ${dv.padStart(5)}`);
  }
}

async function run(): Promise<void> {
  const strategy = (process.env.RAG_STRATEGY?.trim() || 'fixed') as ChunkingStrategy;
  console.log(`▶ День 23: реранк + фильтр релевантности`);
  console.log(`  стратегия:  ${strategy}`);
  console.log(`  индекс:     ${DB_PATH} (read-only, НЕ реиндексируем)`);
  console.log(`  вопросы:    ${EVAL_FILE} (id ${DEMO_IDS.join(', ')})`);
  console.log(`  LLM:        локальная модель (LOCAL_LLM_*)\n`);

  // Железо: CPU всегда; runtime — best-effort через /api/ps; GPU не выдумываем.
  const hw = await detectHardware();
  console.log(`Железо:`);
  console.log(`  CPU:     ${hw.cpuModel} (${hw.cpuCores} ядер)`);
  console.log(`  runtime: ${hw.llmRuntime}`);
  console.log(`  GPU:     ${hw.gpu ?? 'не определено (Ollama /api/ps не отдаёт GPU)'} [source: ${hw.source}]`);
  console.log('');

  const client = makeLocalLlmClient();
  const store = new RagStore(DB_PATH);
  try {
    const count = store.count(strategy);
    if (count === 0) {
      console.error(`Индекс пуст для стратегии "${strategy}". Сначала прогоните day-21.`);
      return;
    }
    console.log(`Чанков в индексе (${strategy}): ${count}\n`);

    const embedder = makeEmbedder();
    const retriever = new Retriever(store, embedder, strategy);
    const all = await loadEval(EVAL_FILE);
    const subset: EvalQuestion[] = DEMO_IDS.map((id) => all.find((q) => q.id === id)).filter(
      (q): q is EvalQuestion => q !== undefined,
    );

    // Этап 1: поэтапный прогон с rerank+rewrite на 3 вопросах.
    console.log(`${'='.repeat(72)}`);
    console.log(
      `Этап 1: поэтапный прогон (pool=${POOL}, topK=${TOP_K}, threshold=${THRESHOLD}, rerank=ON, rewrite=ON)`,
    );
    for (const q of subset) {
      console.log(`\n${'='.repeat(72)}`);
      console.log(`Вопрос ${q.id}: ${q.q}`);
      console.log(`Ожидание: ${q.expectation}`);
      const { answer, sources, debug } = await answerWithRag(client, retriever, q.q, {
        k: TOP_K,
        pool: POOL,
        threshold: THRESHOLD,
        rerank: true,
        rewrite: true,
        onProgress: printStage,
      });
      console.log(`\n— источники (после rerank):`);
      for (const s of sources) {
        console.log(`  [${s.score.toFixed(3)}] ${s.chunk.metadata.source} | ${s.chunk.metadata.section}`);
      }
      console.log(`\n— ответ:`);
      console.log(`  ${truncate(answer)}`);
      if (debug) {
        console.log(
          `\n— debug: pool=${debug.poolSize} filtered=${debug.filteredSize} fallback=${debug.fallback} ` +
            `Δrank=${debug.rankDelta.toFixed(2)} rewritten=${debug.rewritten}`,
        );
      }
    }

    // Этап 2: A/B baseline vs improved на тех же 3 вопросах.
    console.log(`\n${'='.repeat(72)}`);
    console.log(`Этап 2: A/B baseline vs improved (на тех же ${subset.length} вопросах)`);
    const result = await runEvalAB(client, retriever, subset, {
      k: TOP_K,
      pool: POOL,
      threshold: THRESHOLD,
    });
    printAbTable(result);

    // Выводы: Δ coversSources, fallback rate, рекомендации.
    const fbCount = result.perQuestion.filter((r) => r.improved.debug?.fallback).length;
    const fbRate = result.improved.questions > 0 ? fbCount / result.improved.questions : 0;
    const dCovers = result.improved.coversSources - result.baseline.coversSources;
    console.log(`\n${'='.repeat(72)}`);
    console.log(`Выводы:`);
    console.log(
      `  Δ coversSources: ${dCovers >= 0 ? '+' : ''}${dCovers.toFixed(3)} ` +
        `(насыщена на однокорпусном мануале — ожидаемо ~0)`,
    );
    console.log(
      `  fallback rate (improved): ${(fbRate * 100).toFixed(0)}% — доля вопросов, где реранкер не дал валидного JSON (→ cosine-порядок)`,
    );
    console.log(
      `  avgRankDelta (improved): ${result.improved.avgRankDelta.toFixed(2)} ` +
        `(0 = реранк не меняет порядок относительно cosine)`,
    );
    if (fbRate > 0.5) {
      console.log(`  внимание: fallback > 50% — qwen2.5:7b плохо держит JSON-схему реранкера.`);
    }
    if (result.improved.avgRankDelta < 0.1) {
      console.log(`  внимание: rankDelta ~0 — реранк не переупорядочивает (мало кандидатов или модель соглашается с cosine).`);
    }
    console.log(`\nГотово: день 23, индекс не изменён.`);
  } finally {
    store.close();
  }
}

export const demo: Demo = {
  id: 'day-23',
  title: 'Реранкинг и фильтрация RAG (LLM-reranker, threshold, A/B)',
  run,
};
