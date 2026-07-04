// Детерминированный экстрактор цитат (день 24).
// Без LLM, без сети, без импорта client.ts — гарантия присутствия цитаты в каждом
// ответе RAG независимо от качества генерации локальной модели.
//
// Алгоритм: токенизируем вопрос → для каждого чанка выбираем предложение с
// максимальным числом попаданий терминов запроса; при нуле попаданий — берём
// начало chunk.text. snippet всегда непустой, урезан до maxLen.

import type { Quote, ScoredChunk } from './types.js';

// Маленький инлайн-стоп-лист русских союзов/предлогов/местоимений, чтобы не
// считать их «терминами». Без зависимостей (никаких stopword-пакетов).
const STOP_WORDS = new Set<string>([
  'для', 'на', 'по', 'из', 'от', 'до', 'в', 'во', 'с', 'со', 'к', 'ко',
  'при', 'про', 'через', 'без', 'об', 'обо', 'под', 'над', 'за',
  'и', 'или', 'но', 'что', 'чтобы', 'как', 'так', 'если', 'то', 'это',
  'этом', 'этот', 'эта', 'эти', 'тот', 'те', 'когда', 'где', 'чем', 'какой',
  'какая', 'какие', 'который', 'которая', 'тоже', 'также', 'бы', 'ли', 'же',
  'не', 'ни', 'можно', 'нужно', 'надо', 'есть', 'нет', 'был', 'была', 'были',
  'он', 'она', 'они', 'оно', 'мы', 'вы', 'я', 'его', 'её', 'их', 'свой',
]);

const DEFAULT_MAX_LEN = 240;

function tokenizeQuestion(question: string): Set<string> {
  const terms = new Set<string>();
  const lower = question.toLowerCase();
  const words = lower.match(/[a-zа-яё0-9]+/g) ?? [];
  for (const w of words) {
    if (w.length <= 3) continue;
    if (STOP_WORDS.has(w)) continue;
    terms.add(w);
  }
  return terms;
}

function splitSentences(text: string): string[] {
  const parts = text.split(/(?<=[.!?])\s+/);
  const clean = parts
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);
  return clean.length > 0 ? clean : [text.replace(/\s+/g, ' ').trim()];
}

function truncateSnippet(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

function pickBestSentence(text: string, terms: Set<string>): string {
  const sentences = splitSentences(text);
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < sentences.length; i++) {
    const lower = sentences[i].toLowerCase();
    const words = lower.match(/[a-zа-яё0-9]+/g) ?? [];
    let hits = 0;
    for (const w of words) {
      if (terms.has(w)) hits++;
    }
    if (hits > bestScore) {
      bestScore = hits;
      bestIdx = i;
    }
  }
  // При любом попадании возвращаем лучшее предложение; при нуле — первое.
  return sentences[bestIdx];
}

// extractQuotes: ровно один Quote на элемент ranked, snippet всегда непустой.
// opts.maxLen default 240. При ranked.length===0 → [].
export function extractQuotes(
  ranked: ScoredChunk[],
  question: string,
  opts?: { maxLen?: number },
): Quote[] {
  const maxLen = opts?.maxLen ?? DEFAULT_MAX_LEN;
  if (ranked.length === 0) return [];
  const terms = tokenizeQuestion(question);
  const quotes: Quote[] = [];
  for (const sc of ranked) {
    const { chunk } = sc;
    const snippet = truncateSnippet(pickBestSentence(chunk.text, terms), maxLen);
    quotes.push({
      chunkId: chunk.metadata.chunkId,
      source: chunk.metadata.source,
      section: chunk.metadata.section,
      snippet,
    });
  }
  return quotes;
}
