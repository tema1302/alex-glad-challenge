// День 21. Индексация документов.
//
// Задание: взять набор документов (README/статьи/код → текст), реализовать пайплайн
// индексации: chunking → эмбеддинги → сохранение индекса.
// Усиление: метаданные к каждому чанку (source, title/section, chunk_id) + минимум
// 2 стратегии chunking (фиксированный размер / по структуре) и их сравнение.
//
// ВАЖНО: день 21+ — только локальные модели. Эмбеддинги идут на локальный эндпоинт
// (LOCAL_EMBED_*), LLM здесь не используется.
//
// Запуск:
//   pnpm --filter challenge start -- day-21
//   RAG_DOCS_DIR=/path/to/docs pnpm --filter challenge start -- day-21

import path from 'node:path';

import {
  RagStore,
  makeEmbedder,
  runIndexing,
  RAG_STRATEGIES,
} from '../core/rag/index.js';
import type { IndexingResult } from '../core/rag/index.js';
import type { Demo } from './types.js';

const DB_PATH = path.join(process.cwd(), '.data', 'rag.sqlite');
const DEFAULT_DOCS_DIR = path.join(process.cwd(), 'docs');

function printStats(result: IndexingResult): void {
  console.log('\n=== Индекс построен ===\n');
  console.log(
    'стратегия     | чанков | мин  | среднее | макс  | размерность',
  );
  console.log('-'.repeat(64));
  for (const s of RAG_STRATEGIES) {
    const st = result[s];
    if (!st) continue;
    console.log(
      `${s.padEnd(13)} | ${String(st.chunks).padStart(6)} | ${String(st.minLen).padStart(4)} | ${String(st.avgLen).padStart(7)} | ${String(st.maxLen).padStart(5)} | ${st.dim ?? '-'}`,
    );
  }
}

async function run(): Promise<void> {
  const docsDir = process.env.RAG_DOCS_DIR?.trim() || DEFAULT_DOCS_DIR;
  console.log(`▶ День 21: индексация документов`);
  console.log(`  каталог:    ${docsDir}`);
  console.log(`  индекс:     ${DB_PATH}`);
  console.log(`  эмбеддинги: локальная модель (LOCAL_EMBED_*)\n`);

  const store = new RagStore(DB_PATH);
  try {
    const embedder = makeEmbedder();
    const result = await runIndexing(store, { docsDir, embedder });
    printStats(result);

    console.log('\n=== Сравнение стратегий ===');
    const fixed = result['fixed'];
    const structure = result['structure'];
    if (fixed && structure) {
      const diff = structure.chunks - fixed.chunks;
      console.log(
        `fixed даёт ${fixed.chunks} чанков (~${fixed.avgLen} симв), ` +
          `structure — ${structure.chunks} чанков (~${structure.avgLen} симв).`,
      );
      console.log(
        `structure ${diff >= 0 ? 'больше' : 'мельче'} на ${Math.abs(diff)} чанков: ` +
          `чанки выровнены по разделам/файлам, а не по размеру.`,
      );
    }
    console.log('\nГотово. Индекс с метаданными и эмбеддингами сохранён в SQLite.');
  } finally {
    store.close();
  }
}

export const demo: Demo = {
  id: 'day-21',
  title: 'Индексация документов (chunking + embeddings + индекс)',
  run,
};
