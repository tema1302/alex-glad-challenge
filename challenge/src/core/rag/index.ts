// RAG-подсистема (дни 21–22). Все обращения к ИИ — только локальные модели.

export type {
  Chunk,
  ChunkMetadata,
  ChunkingStrategy,
  Embedder,
  ScoredChunk,
  IndexStats,
  Quote,
} from './types.js';

export { extractQuotes } from './quotes.js';

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

export {
  answerWithRag,
  answerNoRag,
  buildRagPrompt,
  filterByThreshold,
  decideGuard,
  GUARD_ANSWER,
  DEFAULT_RAG_THRESHOLD,
} from './rag.js';
export type { RagAnswer, RagDebug, RagOptions, RagStage } from './rag.js';

export { rerankWithLlm } from './rerank.js';
export type { RerankResult } from './rerank.js';

export { rewriteQuery } from './rewrite.js';

export { detectHardware } from './hardware.js';
export type { HardwareInfo } from './hardware.js';

export { indexDocuments, runIndexing, RAG_STRATEGIES } from './pipeline.js';
export type { IndexingResult, RunIndexingOptions } from './pipeline.js';

export { loadEval, runEval, runEvalAB, runEvalDay24, computeDay24Metrics } from './eval.js';
export type {
  EvalQuestion,
  EvalRow,
  EvalMetrics,
  EvalAbRow,
  EvalAbResult,
  Day24Metrics,
} from './eval.js';
