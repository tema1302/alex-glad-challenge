// Ретривер: вопрос -> эмбеддинг -> косинусный поиск top-K чанков из индекса.

import type { ChatSourceFilter, ChunkingStrategy, Embedder, ScoredChunk } from './types.js';
import type { RagStore } from './store.js';

export class Retriever {
  constructor(
    private readonly store: RagStore,
    private readonly embedder: Embedder,
    private readonly strategy: ChunkingStrategy,
    private readonly sourceFilter?: ChatSourceFilter,
  ) {}

  async retrieve(query: string, k = 4): Promise<ScoredChunk[]> {
    const [queryVec] = await this.embedder.embed([query]);
    if (!queryVec) return [];
    return this.store.search(this.strategy, queryVec, k, this.sourceFilter);
  }
}
