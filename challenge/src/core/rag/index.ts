// RAG-подсистема (дни 21–22). Все обращения к ИИ — только локальные модели.

export type {
  Chunk,
  ChunkMetadata,
  ChunkingStrategy,
  Embedder,
  ScoredChunk,
  IndexStats,
} from './types.js';

export type { LoadedDoc } from './loader.js';
export { loadDocs, isCodeSource } from './loader.js';

export { chunkFixed, chunkStructured, chunkDoc } from './chunker.js';
export type { FixedChunkOptions, StructuredChunkOptions } from './chunker.js';

export { HttpEmbedder, makeEmbedder, embedConfigFromEnv } from './embedder.js';
export type { EmbedConfig } from './embedder.js';

export { RagStore } from './store.js';

export { Retriever } from './retriever.js';

export { makeLocalLlmClient, localLlmConfig } from './llm.js';
export type { LocalLlmConfig } from './llm.js';

export { answerWithRag, answerNoRag, buildRagPrompt } from './rag.js';
export type { RagAnswer } from './rag.js';

export { indexDocuments, runIndexing, RAG_STRATEGIES } from './pipeline.js';
export type { IndexingResult, RunIndexingOptions } from './pipeline.js';

export { loadEval, runEval } from './eval.js';
export type { EvalQuestion, EvalRow } from './eval.js';
