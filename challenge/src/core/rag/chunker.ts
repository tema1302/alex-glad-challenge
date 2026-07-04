// Две стратегии разбиения на чанки (день 21, усиление «сравнить стратегии»):
//   fixed      — по фиксированному размеру с перекрытием, по границам строк/слов.
//   structure  — по структуре: заголовки markdown, plain-text маркеры (Часть/Глава/
//                N. Title/страничные -I-), рекурсивный fallback по размеру для длинных
//                секций и бесструктурного текста; один чанк на файл для кода.
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

// --- structure: параметры и хелперы ---

const DEFAULT_TARGET_SIZE = 1000; // целевой размер чанка в рекурсивном fallback, символы
const DEFAULT_OVERLAP = 150;      // перекрытие между под-чанками одной секции, символы
const DEFAULT_MAX_SECTION = 2000; // секция целиком, если тело <= cap; иначе рекурсивный сплит
const DEFAULT_MIN_CHUNK = 120;    // кусок меньше — склеить с предпоследним

export interface StructuredChunkOptions {
  targetSize?: number;
  overlap?: number;
  maxSection?: number;
  minChunkSize?: number;
}

// Детекторы структурных маркеров (порядок = приоритет).
// Плоские маркеры (Часть/Глава/N. Title/page-marker) → level 1. ATX сохраняет иерархию.
function detectHeader(line: string): Header | null {
  // 1) ATX: ^#{1,6}\s+Title
  let m = /^(#{1,6})\s+(.*?)\s*$/.exec(line);
  if (m) return { level: m[1].length, title: m[2] };
  // 2) Часть N: Title / Часть N. Title / Часть N Title
  m = /^Часть\s+(\d+)\s*[:.]?\s*(.*?)\s*$/.exec(line);
  if (m) return { level: 1, title: m[2] ? `Часть ${m[1]}: ${m[2]}` : `Часть ${m[1]}` };
  // 3) Глава N. Title / Глава N Title
  m = /^Глава\s+(\d+)\s*[:.]?\s*(.*?)\s*$/.exec(line);
  if (m) return { level: 1, title: m[2] ? `Глава ${m[1]}: ${m[2]}` : `Глава ${m[1]}` };
  // 4) N. Title — строгий: 1-2 цифры, точка, пробел, ЗАГЛАВНАЯ, без . ! ?, длина title 3..69
  m = /^(\d{1,2})\.\s+([А-ЯA-ZЁ][^.!?\n]{2,68})$/.exec(line);
  if (m) return { level: 1, title: `${m[1]}. ${m[2]}` };
  // 5) Маркеры страниц (EVOLUTE): -I- / -12- / -XLD- → level 1, title = raw маркер
  m = /^-(\d+|[IVXLCDM]+)-\s*$/.exec(line);
  if (m) return { level: 1, title: `-${m[1]}-` };
  return null;
}

// Рекурсивная нарезка длинной секции по приоритету разделителей. Гарантия продвижения —
// последний рубеж: жёсткий сплит по символам. Каждый кусок оканчивается разделителем
// (целостность предложений/строк сохраняется через lookbehind-сплит).
const RECURSIVE_SEPS = ['\n\n', '\n', '. ', '! ', '? ', ' '];

function splitOnSep(text: string, sep: string): string[] {
  const escaped = sep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.split(new RegExp(`(?<=${escaped})`));
}

function splitRecursive(text: string, targetSize: number): string[] {
  const rec = (s: string, size: number, sepIdx: number): string[] => {
    if (s.length <= size) return [s];
    if (sepIdx >= RECURSIVE_SEPS.length) {
      const hard: string[] = [];
      for (let i = 0; i < s.length; i += size) hard.push(s.slice(i, i + size));
      return hard;
    }
    const result: string[] = [];
    let buf = '';
    for (const part of splitOnSep(s, RECURSIVE_SEPS[sepIdx])) {
      if (part.length > size) {
        if (buf) { result.push(buf); buf = ''; }
        result.push(...rec(part, size, sepIdx + 1));
      } else if ((buf + part).length <= size) {
        buf += part;
      } else {
        if (buf) result.push(buf);
        buf = part;
      }
    }
    if (buf) result.push(buf);
    return result;
  };
  return rec(text, targetSize, 0);
}

// Последний кусок меньше minChunk → склеить с предпоследним (качество важнее ровного размера).
function mergeTiny(pieces: string[], minChunk: number): string[] {
  if (pieces.length < 2) return pieces;
  const last = pieces[pieces.length - 1];
  if (last.length < minChunk) {
    return [...pieces.slice(0, -2), pieces[pieces.length - 2] + last];
  }
  return pieces;
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s*/).filter((s) => s.length > 0);
}

// Хвост целых предложений с конца, пока суммарная длина < targetLen.
// Если в тексте нет границы предложения — пустая строка (overlap пропускается).
function tailSentences(text: string, targetLen: number): string {
  const sentences = splitSentences(text);
  if (sentences.length <= 1) return '';
  let tail = '';
  for (let i = sentences.length - 1; i >= 0; i--) {
    if (tail.length >= targetLen) break;
    tail = sentences[i] + tail;
  }
  return tail;
}

// Sentence-aligned перекрытие между под-чанками ОДНОЙ секции.
function applySentenceOverlap(pieces: string[], overlap: number): string[] {
  if (overlap <= 0 || pieces.length < 2) return pieces;
  const result = [...pieces];
  for (let i = 1; i < result.length; i++) {
    const tail = tailSentences(result[i - 1], overlap);
    if (tail) result[i] = tail + result[i];
  }
  return result;
}

export function chunkStructured(doc: LoadedDoc, opts: StructuredChunkOptions = {}): Chunk[] {
  if (isCodeSource(doc.source)) {
    // код — один чанк на файл
    return [{
      text: doc.text.trim(),
      metadata: makeMeta(doc, 0, fileBase(doc.source), fileBase(doc.source)),
    }].filter((c) => c.text.length > 0);
  }

  const targetSize = opts.targetSize ?? DEFAULT_TARGET_SIZE;
  const overlap = opts.overlap ?? DEFAULT_OVERLAP;
  const maxSection = opts.maxSection ?? DEFAULT_MAX_SECTION;
  const minChunk = opts.minChunkSize ?? DEFAULT_MIN_CHUNK;

  const lines = doc.text.split(/\r?\n/);
  const out: Chunk[] = [];
  const indexRef = { i: 0 };
  const stack: Header[] = [];
  let body: string[] = [];
  let headersFound = 0;

  const flush = (): void => {
    if (body.length === 0) return;
    const bodyText = body.join('\n').trim();
    body = [];
    if (bodyText.length === 0) return;
    const hasSection = stack.length > 0;
    const title = hasSection ? stack[stack.length - 1].title : fileBase(doc.source);
    const section = sectionPath(stack);

    // Секция целиком → 1 чанк без префикса (сохраняет эмбеддинги мелких секций rag-sample).
    if (bodyText.length <= maxSection) {
      pushChunk(out, doc, indexRef, bodyText, title, section);
      return;
    }
    // Длинная секция → рекурсивный сплит + склейка мелкого хвоста + sentence-overlap.
    // Перенос заголовка — только при осмысленной секции (не fallback).
    let pieces = splitRecursive(bodyText, targetSize);
    pieces = mergeTiny(pieces, minChunk);
    pieces = applySentenceOverlap(pieces, overlap);
    for (const piece of pieces) {
      pushChunk(out, doc, indexRef, hasSection ? `${title}\n${piece}` : piece, title, section);
    }
  };

  for (const line of lines) {
    const header = detectHeader(line);
    if (header) {
      flush();
      headersFound++;
      while (stack.length > 0 && stack[stack.length - 1].level >= header.level) stack.pop();
      stack.push(header);
    } else {
      body.push(line);
    }
  }
  flush();

  if (headersFound === 0 && doc.text.trim().length > 0) {
    console.warn(
      `[chunker] structure: ни одного заголовка в "${doc.source}" — рекурсивный fallback по ~${targetSize} симв.`,
    );
  }

  return out;
}

export function chunkDoc(
  doc: LoadedDoc,
  strategy: ChunkingStrategy,
  opts: { fixed?: FixedChunkOptions; structured?: StructuredChunkOptions } = {},
): Chunk[] {
  return strategy === 'fixed'
    ? chunkFixed(doc, opts.fixed ?? {})
    : chunkStructured(doc, opts.structured ?? {});
}
