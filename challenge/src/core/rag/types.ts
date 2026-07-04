// Типы RAG-пайплайна (дни 21–22).
// Все обращения к ИИ — только к локальным моделям (см. llm.ts, embedder.ts).

export interface ChunkMetadata {
  source: string;     // путь к файлу / источник
  title: string;      // заголовок раздела или имя файла
  section: string;    // путь по разделам "Top > Sub"
  chunkId: string;    // стабильный идентификатор `${source}::${index}`
}

export interface Chunk {
  text: string;
  metadata: ChunkMetadata;
}

export type ChunkingStrategy = 'fixed' | 'structure';

export interface Embedder {
  /** Размерность вектора. Неизвестна до первого вызова. */
  readonly dim: number | undefined;
  embed(texts: string[]): Promise<number[][]>;
}

export interface ScoredChunk {
  chunk: Chunk;
  score: number;       // косинусное сходство, 0..1
}

export interface IndexStats {
  strategy: ChunkingStrategy;
  chunks: number;
  avgLen: number;
  minLen: number;
  maxLen: number;
  dim: number | undefined;
}
