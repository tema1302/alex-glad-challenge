// Ингест заметки владельца (/rag/ingest) в партицию 'notes' rag.sqlite.
// НЕ runIndexing/indexDocuments (pipeline.ts): заметке нужна атомарность уровня
// ОДНОЙ записи — все векторы считаются ДО первого DELETE/INSERT (падение
// mid-embed оставляет старую заметку нетронутой). Идемпотентность: insertChunks —
// plain INSERT без UNIQUE (store.ts), поэтому обновление = delete-then-insert по
// стабильному source='note://<slug(title)>'. Коллизия slug (одно title) —
// осознанная перезапись = семантика «обновить заметку».

import type { Chunk, ChunkingStrategy, Embedder } from './types.js';
import type { LoadedDoc } from './loader.js';
import { chunkDoc } from './chunker.js';
import type { RagStore } from './store.js';

export const NOTES_STRATEGY: ChunkingStrategy = 'notes';

// Тот же батч, что в indexDocuments (pipeline.ts): локальный /embeddings терпит
// батчи такого размера, заметки обычно в 1-3 чанка.
const EMBED_BATCH = 32;

export interface NoteIngestResult {
  source: string;   // 'note://<slug>', стабилен для данного title
  title: string;
  chunks: number;
}

// Стабильный хеш title (djb2 по UTF-16 кодам): тот же title → тот же source
// (обновление через delete-then-insert), другой title → другой source.
function hash36(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

// Slug из title: [a-z0-9-], прочее → '-'. Кириллица/пунктуация дают пустую базу →
// fallback 'note-<hash>' (транслит не нужен: человекочитаемость source не требуется —
// UI показывает title из listNotes). Хеш-суффикс разводит «Собрание» и «Собрание!»,
// для которых base совпадает, а заметки разные.
function noteSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  const hash = hash36(title);
  return base ? `${base}-${hash}` : `note-${hash}`;
}

export function noteSourceFromTitle(title: string): string {
  return `note://${noteSlug(title)}`;
}

export async function ingestNote(
  store: RagStore,
  embedder: Embedder,
  note: { title: string; text: string },
): Promise<NoteIngestResult> {
  const { title, text } = note;
  const source = noteSourceFromTitle(title);

  // Синтетический LoadedDoc: chunkDoc('notes') роутится в chunkStructured
  // (chunker.ts тернарник) — markdown-заголовки заметки секционируют чанки,
  // бесструктурный текст уходит в рекурсивный fallback.
  const doc: LoadedDoc = { source, text };
  const chunks: Chunk[] = chunkDoc(doc, NOTES_STRATEGY).map((c) => ({
    ...c,
    // title заметки во ВСЕХ чанках: агрегация listNotes/stats показывает его
    // вместо слага (план §1: listNotes → title первого чанка).
    metadata: { ...c.metadata, title },
  }));

  // 1) ВСЕ векторы до первой мутации хранилища.
  const vecs: number[][] = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const batchVecs = await embedder.embed(batch.map((c) => c.text));
    if (batchVecs.length !== batch.length) {
      throw new Error(`embeddings count mismatch: ${batchVecs.length} != ${batch.length}`);
    }
    vecs.push(...batchVecs);
  }

  // 2) dim-guard (прецедент assertDimCompatible, tg/topicCollector.ts): cosine берёт
  // Math.min — смена модели эмбеддингов тихо деградировала бы поиск. Сравнение
  // с dim УЖЕ записанной партиции 'notes' (не с конфигом) — на пустой базе гард
  // не мешает первому ингесту с любой моделью.
  if (vecs.length > 0) {
    const st = store.stats(NOTES_STRATEGY);
    if (st.dim != null && st.dim !== vecs[0].length) {
      throw new Error(
        `векторы другой размерности: база заметок собрана другой моделью ` +
          `(index dim=${st.dim}, новые=${vecs[0].length})`,
      );
    }
  }

  // 3) delete-then-insert: атомарное обновление заметки по её source.
  store.deleteBySource(NOTES_STRATEGY, source);
  store.insertChunks(NOTES_STRATEGY, chunks, vecs);

  return { source, title, chunks: chunks.length };
}
