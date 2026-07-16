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

// 'telegram' — НЕ входит в RAG_STRATEGIES (pipeline.ts): TG-чанки строятся
// инлайн-маппером (core/tg/topicCollector.ts → messageToChunk) и индексируются
// через indexDocuments напрямую, минуя runIndexing/chunkDoc. Изоляция стратегий
// в rag.sqlite (partition by strategy TEXT) сохраняет fixed/structure нетронутыми.
// 'docs' — НЕ входит в RAG_STRATEGIES: кураторский корпус dev-assistant
// (core/rag/docsCorpus.ts, явный allow-list .md) → chunkDoc(strategy='docs')
// роутится в chunkStructured (chunker.ts тернарник :265, markdown section-aware),
// индексируется через indexDocuments напрямую. Изоляция в rag.sqlite сохраняет
// остальные партиции нетронутыми.
export type ChunkingStrategy = 'fixed' | 'structure' | 'telegram' | 'docs';

export interface Embedder {
  /** Размерность вектора. Неизвестна до первого вызова. */
  readonly dim: number | undefined;
  embed(texts: string[]): Promise<number[][]>;
}

export interface ScoredChunk {
  chunk: Chunk;
  score: number;       // косинусное сходство, 0..1
}

// Область поиска по source-префиксу для TG-партиции: chatKey ('-100…' | '@username')
// сужает search до чанков одного чата; topicId опц. уточняет до топика. Применяется
// в RagStore.search как parameterized LIKE на source-префиксе 'tg://chat/<key>/…'.
export interface ChatSourceFilter {
  chatKey: string;
  topicId?: number;
}

// Цитата из найденного чанка (день 24): детерминированный excerpt из chunk.text.
// Не LLM-emit — гарантия наличия в каждом ответе без зависимости от модели.
export interface Quote {
  chunkId: string;   // chunk.metadata.chunkId
  source: string;    // chunk.metadata.source
  section: string;   // chunk.metadata.section
  snippet: string;   // детерминированный фрагмент chunk.text
}

export interface IndexStats {
  strategy: ChunkingStrategy;
  chunks: number;
  avgLen: number;
  minLen: number;
  maxLen: number;
  dim: number | undefined;
}
