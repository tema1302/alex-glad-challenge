// День 22. Первый RAG-запрос.
//
// Задание: вопрос → поиск релевантных чанков → объединение с вопросом → запрос к LLM.
// Сравнение: ответ без RAG vs ответ с RAG.
// Усиление: мини-набор из 10 контрольных вопросов (src/data/rag-eval.json) с
// ожиданием и ожидаемыми источниками.
//
// ВАЖНО: день 21+ — только локальные модели. LLM идёт на локальный эндпоинт
// (LOCAL_LLM_*), эмбеддинги — тоже локально (LOCAL_EMBED_*).
//
// Перед запуском прогоните day-21 (индекс должен быть построен).
//
// Запуск:
//   pnpm --filter challenge start -- day-22
//   RAG_STRATEGY=structure pnpm --filter challenge start -- day-22

import path from 'node:path';

import {
  RagStore,
  Retriever,
  makeEmbedder,
  makeLocalLlmClient,
  loadEval,
  runEval,
} from '../core/rag/index.js';
import type { ChunkingStrategy, EvalRow } from '../core/rag/index.js';
import type { Demo } from './types.js';

const DB_PATH = path.join(process.cwd(), '.data', 'rag.sqlite');
const EVAL_FILE = path.join(process.cwd(), 'src', 'data', 'rag-eval.json');

function truncate(s: string, max = 320): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max) + '…' : clean;
}

function printRow(row: EvalRow, index: number): void {
  console.log(`\n${'='.repeat(72)}`);
  console.log(`Вопрос ${index + 1}: ${row.question.q}`);
  console.log(`Ожидание: ${row.question.expectation}`);
  if (row.question.sources && row.question.sources.length > 0) {
    console.log(`Источники (ожид): ${row.question.sources.join(', ')}`);
  }
  console.log(`\n— без RAG (общие знания):`);
  console.log(`  ${truncate(row.noRag)}`);
  console.log(`\n— с RAG (по индексу):`);
  console.log(`  ${truncate(row.withRag)}`);
  console.log(`\n— найденные источники:`);
  for (const s of row.sources) {
    console.log(`  [${s.score.toFixed(3)}] ${s.source} | ${s.section}`);
  }
}

async function run(): Promise<void> {
  const strategy = (process.env.RAG_STRATEGY?.trim() || 'fixed') as ChunkingStrategy;
  console.log(`▶ День 22: RAG vs без RAG`);
  console.log(`  стратегия:  ${strategy}`);
  console.log(`  индекс:     ${DB_PATH}`);
  console.log(`  вопросы:    ${EVAL_FILE}`);
  console.log(`  LLM:        локальная модель (LOCAL_LLM_*)\n`);

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
    const questions = await loadEval(EVAL_FILE);

    const rows = await runEval(client, retriever, questions);
    rows.forEach((row, i) => printRow(row, i));

    console.log(`\n${'='.repeat(72)}`);
    console.log(`Готово: ${rows.length} вопросов, ответы в двух режимах.`);
  } finally {
    store.close();
  }
}

export const demo: Demo = {
  id: 'day-22',
  title: 'Первый RAG-запрос (с RAG / без RAG, 10 контрольных вопросов)',
  run,
};
