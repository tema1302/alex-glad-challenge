// Персистентный индекс RAG в SQLite через node:sqlite (без нативных сборок).
// Файл: challenge/.data/rag.sqlite (вне git).
// Векторы хранятся как JSON-колонка; поиск — brute-force косинус в JS.
// Чанки тегируются стратегией (fixed/structure) для сравнения.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Chunk, ChunkMetadata, ChunkingStrategy, IndexStats, ScoredChunk } from './types.js';

interface StoredRow {
  id: number;
  strategy: string;
  source: string;
  title: string;
  section: string;
  chunk_idx: number;
  chunk_id: string;
  text: string;
  embedding: string;
  dim: number | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rag_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy TEXT NOT NULL,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  section TEXT NOT NULL,
  chunk_idx INTEGER NOT NULL,
  chunk_id TEXT NOT NULL,
  text TEXT NOT NULL,
  embedding TEXT NOT NULL,
  dim INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rag_strategy ON rag_chunks(strategy);
CREATE INDEX IF NOT EXISTS idx_rag_source ON rag_chunks(source);
`;

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function rowToChunk(r: StoredRow): Chunk {
  const metadata: ChunkMetadata = {
    source: r.source,
    title: r.title,
    section: r.section,
    chunkId: r.chunk_id,
  };
  return { text: r.text, metadata };
}

export class RagStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  count(strategy: ChunkingStrategy): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM rag_chunks WHERE strategy = ?')
      .get(strategy) as { n: number };
    return row.n;
  }

  clearStrategy(strategy: ChunkingStrategy): void {
    this.db.prepare('DELETE FROM rag_chunks WHERE strategy = ?').run(strategy);
  }

  insertChunks(strategy: ChunkingStrategy, chunks: Chunk[], embeddings: number[][]): void {
    if (chunks.length !== embeddings.length) {
      throw new Error(`insertChunks: ${chunks.length} чанков vs ${embeddings.length} векторов`);
    }
    const stmt = this.db.prepare(
      'INSERT INTO rag_chunks (strategy, source, title, section, chunk_idx, chunk_id, text, embedding, dim) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    this.db.exec('BEGIN');
    try {
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const vec = embeddings[i];
        stmt.run(
          strategy,
          c.metadata.source,
          c.metadata.title,
          c.metadata.section,
          i,
          c.metadata.chunkId,
          c.text,
          JSON.stringify(vec),
          vec.length,
        );
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  search(strategy: ChunkingStrategy, queryVec: number[], k: number): ScoredChunk[] {
    const rows = this.db
      .prepare('SELECT * FROM rag_chunks WHERE strategy = ?')
      .all(strategy) as unknown as StoredRow[];
    const scored: ScoredChunk[] = rows.map((r) => {
      const vec = JSON.parse(r.embedding) as number[];
      return { chunk: rowToChunk(r), score: cosine(queryVec, vec) };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  stats(strategy: ChunkingStrategy): IndexStats {
    const rows = this.db
      .prepare('SELECT text, dim FROM rag_chunks WHERE strategy = ?')
      .all(strategy) as unknown as { text: string; dim: number | null }[];
    if (rows.length === 0) {
      return { strategy, chunks: 0, avgLen: 0, minLen: 0, maxLen: 0, dim: undefined };
    }
    const lens = rows.map((r) => r.text.length);
    const sum = lens.reduce((acc, n) => acc + n, 0);
    const dim = rows[0].dim ?? undefined;
    return {
      strategy,
      chunks: rows.length,
      avgLen: Math.round(sum / rows.length),
      minLen: Math.min(...lens),
      maxLen: Math.max(...lens),
      dim,
    };
  }
}
