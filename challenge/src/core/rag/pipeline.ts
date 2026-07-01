// Оркестрация индексации (день 21): загрузка документов -> chunking ->
// батчевые эмбеддинги -> запись в индекс. Поддержка обеих стратегий.

import type { Chunk, ChunkingStrategy, Embedder, IndexStats } from './types.js';
import { loadDocs } from './loader.js';
import { chunkDoc } from './chunker.js';
import type { FixedChunkOptions } from './chunker.js';
import type { RagStore } from './store.js';
import { makeEmbedder } from './embedder.js';

export const RAG_STRATEGIES: ChunkingStrategy[] = ['fixed', 'structure'];

export interface IndexingResult {
  [strategy: string]: IndexStats;
}

export async function indexDocuments(
  store: RagStore,
  strategy: ChunkingStrategy,
  chunks: Chunk[],
  embedder: Embedder,
  batchSize = 32,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const vecs = await embedder.embed(batch.map((c) => c.text));
    if (vecs.length !== batch.length) {
      throw new Error(`embeddings count mismatch: ${vecs.length} != ${batch.length}`);
    }
    store.insertChunks(strategy, batch, vecs);
    onProgress?.(Math.min(i + batchSize, chunks.length), chunks.length);
  }
}

export interface RunIndexingOptions {
  docsDir: string;
  strategies?: ChunkingStrategy[];
  embedder?: Embedder;
  fixed?: FixedChunkOptions;
}

export async function runIndexing(
  store: RagStore,
  opts: RunIndexingOptions,
): Promise<IndexingResult> {
  const strategies = opts.strategies ?? RAG_STRATEGIES;
  const embedder = opts.embedder ?? makeEmbedder();
  const docs = await loadDocs(opts.docsDir);
  if (docs.length === 0) {
    throw new Error(
      `Не найдено документов в ${opts.docsDir} (.md/.txt/.ts/.js). Положите файлы или укажите другой путь.`,
    );
  }

  const result: IndexingResult = {};
  for (const strategy of strategies) {
    const chunks = docs.flatMap((d) => chunkDoc(d, strategy, opts.fixed));
    store.clearStrategy(strategy);
    await indexDocuments(store, strategy, chunks, embedder);
    result[strategy] = store.stats(strategy);
  }
  return result;
}
