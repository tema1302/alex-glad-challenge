// SSE-контракт между Route Handlers (server) и клиентом. P1+ использует /api/rag/query.
// type-only — безопасно для client bundle (без server-only, без core/).

export type RagStageStep = 'rewrite' | 'retrieve' | 'filter' | 'rerank' | 'guard' | 'llm';

export interface SseStageEvent {
  type: 'stage';
  step: RagStageStep;
  detail?: unknown;
}
export interface SseTokenEvent {
  type: 'token';
  delta: string;
}

// Плоские сериализуемые проекции core/-типов (без импорта core/ — chokepoint).
// ScoredChunk → SseSource, Quote → SseQuote, RagDebug → SseDebug.
export interface SseSource {
  chunkId: string;
  source: string;
  title: string;
  section: string;
  score: number;
}
export interface SseQuote {
  chunkId: string;
  source: string;
  section: string;
  snippet: string;
}
export interface SseDebug {
  poolSize: number;
  filteredSize: number;
  threshold: number;
  rerankApplied: boolean;
  fallback: boolean;
  rankDelta: number;
  rewritten: boolean;
  effectiveQuery?: string;
  gaveUp: boolean;
  topK?: number;
}

// Использование токенов. Для RAG — из API usage; для /chat (P2) — аппроксимация
// по символам (chatStream не возвращает usage; менять core/ в P2 запрещено).
export interface SseUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface SseDoneEvent {
  type: 'done';
  answer?: string;
  sources?: SseSource[];
  quotes?: SseQuote[];
  debug?: SseDebug;
  usage?: SseUsage;
}
export interface SseErrorEvent {
  type: 'error';
  message: string;
}

export type SseEvent = SseStageEvent | SseTokenEvent | SseDoneEvent | SseErrorEvent;

// --- P4a: /api/blog/news SSE ---
// runNewsPipeline не имеет onProgress-колбэка, поэтому стрим отдаёт только start → done/error.
// Задача P4a это допускает; live-стадии 3-х агентов — в P4b (pipeline FSM / scout SSE).
export interface SseBlogNewsStage {
  type: 'stage';
  step: 'start';
}
export interface SseBlogNewsDone {
  type: 'done';
  post: { id: number; content: string } | null;
  topNews: Array<{ title: string; score: number; why: string }>;
  verdict: string | null;
}
export interface SseBlogNewsError {
  type: 'error';
  message: string;
}
export type SseBlogNewsEvent = SseBlogNewsStage | SseBlogNewsDone | SseBlogNewsError;

// --- P4b: /api/blog/scout SSE ---
// runSourceAgents не имеет onProgress-колбэка (внутри Promise.all + console.log), поэтому
// стрим отдаёт только start → done/error — аналог /api/blog/news. В done — финальный топ
// оркестратора + сводка по каждому source-агенту (из rawResults: имя/кол-во тем/ошибка).
export interface SseBlogScoutTopic {
  title: string;
  source: string;
  hypeScore: number;
  hypeReason: string;
  orchestratorScore: number;
  orchestratorReason: string;
  url: string | null;
}
export interface SseBlogScoutAgent {
  agent: string;
  count: number;
  error: string | null;
}
export interface SseBlogScoutStage {
  type: 'stage';
  step: 'start';
}
export interface SseBlogScoutDone {
  type: 'done';
  ranked: SseBlogScoutTopic[];
  agents: SseBlogScoutAgent[];
}
export interface SseBlogScoutError {
  type: 'error';
  message: string;
}
export type SseBlogScoutEvent = SseBlogScoutStage | SseBlogScoutDone | SseBlogScoutError;

// --- P3b: /api/tg/collect, /api/rag/index, /api/rag/index-tg SSE ---
// Длительные операции: MTProto-сбор топика / батчевая эмбеддинг-индексация.
// collectTopic и indexDocuments имеют onProgress → live-стадии; runIndexing — без
// внешнего onProgress (старт→done, по аналогии с P4a news/scout).

// /api/tg/collect — single-topic MTProto-сбор в tg.sqlite.
export interface SseTgCollectStage {
  type: 'stage';
  step: 'start' | 'progress';
  detail?: {
    chatKey?: string;
    topicId?: number;
    chatTitle?: string;
    fetched?: number;
    newlyInserted?: number;
    lastId?: number;
  };
}
export interface SseTgCollectDone {
  type: 'done';
  mode: string; // 'full' | 'resume' | 'incremental'
  fetched: number;
  newlyInserted: number;
  updated: number;
  total: number;
  chatKey: string;
  topicId: number;
  chatTitle: string;
}
export interface SseTgCollectError {
  type: 'error';
  message: string;
}
export type SseTgCollectEvent = SseTgCollectStage | SseTgCollectDone | SseTgCollectError;

// /api/rag/index — индексация docs (fixed/structure) → rag.sqlite.
export interface SseRagIndexStage {
  type: 'stage';
  step: 'start';
  detail?: { docsDir: string; strategies: string[] };
}
export interface SseRagIndexStrategyStat {
  strategy: string;
  chunks: number;
  avgLen: number;
  dim: number | null;
}
export interface SseRagIndexDone {
  type: 'done';
  result: SseRagIndexStrategyStat[];
}
export interface SseRagIndexError {
  type: 'error';
  message: string;
}
export type SseRagIndexEvent = SseRagIndexStage | SseRagIndexDone | SseRagIndexError;

// /api/rag/index-tg — индексация telegram (single-topic | whole-chat).
// onProgress от indexDocuments → step:'progress' (indexed/total). Доп. step:'clear'
// сигнализирует о деструктивной очистке (single-topic reset = clearStrategy('telegram')).
export interface SseRagIndexTgStage {
  type: 'stage';
  step: 'start' | 'collect' | 'progress' | 'clear';
  detail?: {
    mode?: string;
    chatKey?: string;
    topicId?: number;
    indexed?: number;
    total?: number;
    cleared?: number;
    // collect onProgress (fetched/newlyInserted) — для шагов collect/progress.
    fetched?: number;
    newlyInserted?: number;
  };
}
export interface SseRagIndexTgDone {
  type: 'done';
  mode: 'single' | 'whole';
  chatKey: string;
  indexed: number; // сколько чанков записано в этом прогоне
  total: number; // всего в telegram-партиции после
  dim: number | null;
}
export interface SseRagIndexTgError {
  type: 'error';
  message: string;
}
export type SseRagIndexTgEvent = SseRagIndexTgStage | SseRagIndexTgDone | SseRagIndexTgError;
