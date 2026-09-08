// Unit: core-слой партиции 'notes' (П-1 /rag/ingest). Без сети и Ollama:
// RagStore на ':memory:' (node:sqlite, WAL-pragma на in-memory БД — no-op),
// embedder — детерминированная заглушка. Покрывает: chunkDoc('notes') несёт
// source 'note://…'; deleteBySource удаляет только свои строки; ingestNote —
// идемпотентный delete-then-insert (без дубликатов), title во всех чанках,
// dim-mismatch → throw без частичной записи.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chunkDoc } from '@challenge/core/rag/chunker.js';
import { RagStore } from '@challenge/core/rag/store.js';
import { ingestNote, noteSourceFromTitle, NOTES_STRATEGY } from '@challenge/core/rag/notesIngest.js';
import type { Chunk, Embedder } from '@challenge/core/rag/types.js';

// Две markdown-секции ~1380 симв. каждая (≤ maxSection 2000) → ровно 2 чанка,
// заголовки найдены — рекурсивный fallback (и его console.warn) не задействован.
const LONG_TEXT = [
  '# Раздел один',
  '',
  'Квантограф флибустиев. '.repeat(60),
  '',
  '# Раздел два',
  '',
  'Гиперцентрифуга момента. '.repeat(60),
].join('\n');

const SHORT_TEXT = '# Коротыш\n\nПять слов про момент.';

// Заглушка по образцу HttpEmbedder: dim известен, векторы детерминированы
// текстом (не нулевые — cosine определён).
function fakeEmbedder(dim: number): Embedder {
  return {
    dim,
    embed: async (texts: string[]) =>
      texts.map((t) => Array.from({ length: dim }, (_, i) => ((t.length + i * 7) % 11) - 5)),
  };
}

describe('chunkDoc strategy=notes', () => {
  it('чанки наследуют doc.source (note://…) и секционируются по заголовкам', () => {
    const source = 'note://test-doc-abc';
    const chunks = chunkDoc({ source, text: LONG_TEXT }, NOTES_STRATEGY);
    expect(chunks.length).toBe(2);
    for (const c of chunks) {
      expect(c.metadata.source).toBe(source);
      expect(c.metadata.chunkId.startsWith(`${source}::`)).toBe(true);
    }
    expect(chunks[0]!.metadata.section).toBe('Раздел один');
    expect(chunks[1]!.metadata.section).toBe('Раздел два');
  });
});

describe('RagStore.deleteBySource', () => {
  let store: RagStore;
  beforeEach(() => {
    store = new RagStore(':memory:');
  });
  afterEach(() => {
    store.close();
  });

  it('удаляет только строки своего (strategy, source), возвращает их число', () => {
    const chunkA: Chunk = {
      text: 'а-один',
      metadata: { source: 'note://a', title: 'A', section: '', chunkId: 'note://a::0' },
    };
    const chunkB: Chunk = {
      text: 'б-один',
      metadata: { source: 'note://b', title: 'B', section: '', chunkId: 'note://b::0' },
    };
    store.insertChunks('notes', [chunkA, chunkA], [
      [1, 0],
      [0, 1],
    ]);
    store.insertChunks('notes', [chunkB], [[1, 1]]);

    expect(store.deleteBySource('notes', 'note://a')).toBe(2);
    expect(store.count('notes')).toBe(1);
    // чужая стратегия / чужой source — 0 удалённых, данные целы
    expect(store.deleteBySource('docs', 'note://b')).toBe(0);
    expect(store.deleteBySource('notes', 'note://нет-такого')).toBe(0);
    expect(store.count('notes')).toBe(1);
  });
});

describe('ingestNote', () => {
  let store: RagStore;
  beforeEach(() => {
    store = new RagStore(':memory:');
  });
  afterEach(() => {
    store.close();
  });

  it('первый ингест: source=note://, все чанки в партиции, dim = dim(embedder)', async () => {
    const res = await ingestNote(store, fakeEmbedder(2), { title: 'Мой план', text: LONG_TEXT });
    expect(res.source.startsWith('note://')).toBe(true);
    expect(res.title).toBe('Мой план');
    expect(res.chunks).toBe(2);
    expect(store.count(NOTES_STRATEGY)).toBe(2);
    expect(store.stats(NOTES_STRATEGY).dim).toBe(2);
  });

  it('повторный ингест с тем же title: тот же source, без дубликатов, текст обновлён', async () => {
    const embedder = fakeEmbedder(2);
    const first = await ingestNote(store, embedder, { title: 'Мой план', text: LONG_TEXT });
    const second = await ingestNote(store, embedder, { title: 'Мой план', text: SHORT_TEXT });

    expect(second.source).toBe(first.source); // стабильность slug между вызовами
    expect(second.chunks).toBe(1);
    expect(store.count(NOTES_STRATEGY)).toBe(1); // delete-then-insert: дубликатов нет

    const all = store.search(NOTES_STRATEGY, [1, 1], 100);
    expect(all).toHaveLength(1);
    expect(all[0]!.chunk.metadata.source).toBe(first.source);
    // title заметки во всех чанках (не слаг и не markdown-заголовок секции)
    expect(all[0]!.chunk.metadata.title).toBe('Мой план');
    expect(all[0]!.chunk.text).toContain('Пять слов');
    expect(all[0]!.chunk.text).not.toContain('Квантограф');
  });

  it('разные title → разные source, deleteBySource не трогает чужие заметки', async () => {
    const embedder = fakeEmbedder(2);
    const a = await ingestNote(store, embedder, { title: 'Заметка А', text: LONG_TEXT });
    const b = await ingestNote(store, embedder, { title: 'Заметка Б', text: SHORT_TEXT });
    expect(a.source).not.toBe(b.source);
    expect(store.count(NOTES_STRATEGY)).toBe(a.chunks + b.chunks);

    expect(store.deleteBySource('notes', a.source)).toBe(a.chunks);
    expect(store.count(NOTES_STRATEGY)).toBe(b.chunks);
  });

  it('dim-mismatch → throw ДО записи, старая заметка нетронута (нет частичной записи)', async () => {
    const old: Chunk = {
      text: 'старый чанк',
      metadata: { source: 'note://old', title: 'Старая', section: '', chunkId: 'note://old::0' },
    };
    store.insertChunks('notes', [old], [[1, 2]]); // база dim=2

    await expect(
      ingestNote(store, fakeEmbedder(3), { title: 'Новая', text: LONG_TEXT }),
    ).rejects.toThrow(/другой размерности/);

    expect(store.count(NOTES_STRATEGY)).toBe(1); // откат не нужен: запись не начиналась
  });
});

describe('noteSourceFromTitle', () => {
  it('стабилен, различает близкие title и деградирует к note-<hash> без латиницы', () => {
    expect(noteSourceFromTitle('Мой план')).toBe(noteSourceFromTitle('Мой план'));
    expect(noteSourceFromTitle('Мой план')).not.toBe(noteSourceFromTitle('Мой план!'));
    for (const title of ['Мой план', 'Мой план!', 'Собрание', 'Заметка']) {
      expect(noteSourceFromTitle(title)).toMatch(/^note:\/\/[a-z0-9-]+$/);
    }
  });
});
