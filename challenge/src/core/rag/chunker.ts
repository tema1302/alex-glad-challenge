// Две стратегии разбиения на чанки (день 21, усиление «сравнить стратегии»):
//   fixed      — по фиксированному размеру с перекрытием, по границам строк/слов.
//   structure  — по структуре: заголовки markdown (#..######) для текста,
//                один чанк на файл для кода.
// Каждый чанк несёт метаданные: source, title, section, chunkId.

import path from 'node:path';
import type { Chunk, ChunkMetadata, ChunkingStrategy } from './types.js';
import type { LoadedDoc } from './loader.js';
import { isCodeSource } from './loader.js';

function fileBase(source: string): string {
  return path.basename(source);
}

function makeMeta(doc: LoadedDoc, index: number, title: string, section: string): ChunkMetadata {
  return {
    source: doc.source,
    title,
    section,
    chunkId: `${doc.source}::${index}`,
  };
}

function pushChunk(out: Chunk[], doc: LoadedDoc, indexRef: { i: number }, text: string, title: string, section: string): void {
  const trimmed = text.trim();
  if (trimmed.length === 0) return;
  out.push({ text: trimmed, metadata: makeMeta(doc, indexRef.i, title, section) });
  indexRef.i++;
}

// --- fixed ---

export interface FixedChunkOptions {
  size?: number;       // целевой размер чанка в символах
  overlap?: number;    // перекрытие в символах
}

export function chunkFixed(doc: LoadedDoc, opts: FixedChunkOptions = {}): Chunk[] {
  const size = opts.size ?? 1000;
  const overlap = Math.min(opts.overlap ?? 200, size - 1);
  const text = doc.text;
  const out: Chunk[] = [];
  const indexRef = { i: 0 };
  if (text.length === 0) return out;

  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    // откусить по границе строки/слова, если не конец текста
    if (end < text.length) {
      const lineBreak = text.lastIndexOf('\n', end);
      if (lineBreak > start + Math.floor(size * 0.5)) {
        end = lineBreak;
      } else {
        const space = text.lastIndexOf(' ', end);
        if (space > start + Math.floor(size * 0.5)) end = space;
      }
    }
    const slice = text.slice(start, end);
    pushChunk(out, doc, indexRef, slice, fileBase(doc.source), fileBase(doc.source));

    if (end >= text.length) break;
    const nextStart = end - overlap;
    // гарантия продвижения
    start = nextStart > start ? nextStart : start + 1;
  }
  return out;
}

// --- structure ---

interface Header {
  level: number;
  title: string;
}

function sectionPath(stack: Header[]): string {
  return stack.map((h) => h.title).join(' > ');
}

export function chunkStructured(doc: LoadedDoc): Chunk[] {
  if (isCodeSource(doc.source)) {
    // код — один чанк на файл
    return [{
      text: doc.text.trim(),
      metadata: makeMeta(doc, 0, fileBase(doc.source), fileBase(doc.source)),
    }].filter((c) => c.text.length > 0);
  }

  const lines = doc.text.split(/\r?\n/);
  const out: Chunk[] = [];
  const indexRef = { i: 0 };
  const stack: Header[] = [];
  let body: string[] = [];

  const flush = (): void => {
    if (body.length === 0) return;
    const title = stack.length > 0 ? stack[stack.length - 1].title : fileBase(doc.source);
    pushChunk(out, doc, indexRef, body.join('\n'), title, sectionPath(stack));
    body = [];
  };

  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*?)\s*$/.exec(line);
    if (m) {
      flush();
      const level = m[1].length;
      const title = m[2];
      // обрезать стек до родительского уровня, затем положить текущий
      while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title });
    } else {
      body.push(line);
    }
  }
  flush();

  return out;
}

export function chunkDoc(doc: LoadedDoc, strategy: ChunkingStrategy, opts: FixedChunkOptions = {}): Chunk[] {
  return strategy === 'fixed' ? chunkFixed(doc, opts) : chunkStructured(doc);
}
