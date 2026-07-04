// LLM-as-reranker (день 23): второй этап RAG-пайплайна.
// Переиспользуем makeLocalLlmClient — отдельного rerank-эндпоинта локально нет
// (Ollama даёт только /chat/completions и /embeddings).
// Контракт: модель возвращает строго JSON {"ranked":[<номера>]}; при любой ошибке
// парсинга — fallback на исходный cosine-порядок (не падать, не терять чанки).

import type { LlmClient } from '../client.js';
import { msg } from '../types.js';
import type { ScoredChunk } from './types.js';

export interface RerankResult {
  ranked: ScoredChunk[];
  fallback: boolean;
  rankDelta: number; // среднее |старая_позиция − новая_позиция| по итоговому списку
}

const SYSTEM_RERANK =
  'Отвечай ТОЛЬКО на русском языке и строго в формате JSON. ' +
  'Ты — реранкер. Даны фрагменты [1..N] и вопрос. Оцени семантическую релевантность ' +
  'каждого фрагмента вопросу и верни JSON вида ' +
  '{"ranked":[<номера фрагментов от самого релевантного к наименее>]}. ' +
  'Только числа от 1 до N через запятую внутри массива, без объяснений и лишних полей.';

// Компактное представление текста чанка для промпта реранкера: убираем лишние
// пробелы и урезаем до ~500 символов, чтобы не раздувать токенаж.
function compact(text: string, max = 500): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max) + '…' : clean;
}

// Толерантный парсинг ответа: берём первое {...}, в нём — "ranked":[...].
// Индексы 1-based, в диапазоне [1..n], без дублей. Невалидно → null (вызовет fallback).
function parseRanked(raw: string, n: number, limit: number): number[] | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  const body = raw.slice(start, end + 1);
  const m = body.match(/"ranked"\s*:\s*\[([0-9,\s]*)\]/);
  if (!m) return null;
  const idx = m[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number(s))
    .filter((x) => Number.isInteger(x));
  if (idx.length === 0) return null;
  const seen = new Set<number>();
  const clean: number[] = [];
  for (const x of idx) {
    if (x >= 1 && x <= n && !seen.has(x)) {
      seen.add(x);
      clean.push(x);
      if (clean.length >= limit) break;
    }
  }
  return clean.length > 0 ? clean : null;
}

function fallback(candidates: ScoredChunk[], topK: number): RerankResult {
  // Сохраняем cosine-порядок: rankDelta=0 (порядок не изменился).
  return { ranked: candidates.slice(0, topK), fallback: true, rankDelta: 0 };
}

export async function rerankWithLlm(
  client: LlmClient,
  question: string,
  candidates: ScoredChunk[],
  topK: number,
): Promise<RerankResult> {
  if (candidates.length === 0) return { ranked: [], fallback: false, rankDelta: 0 };

  const n = candidates.length;
  const limit = Math.min(topK, n);
  const listing = candidates
    .map((c, i) => `[${i + 1}] ${compact(c.chunk.text)}`)
    .join('\n\n');
  const user =
    `Вопрос: ${question}\n\nФрагменты (N=${n}):\n${listing}\n\n` +
    `Верни строго JSON {"ranked":[...]} с номерами от 1 до ${n} ` +
    `(не более ${limit}) в порядке убывания релевантности вопросу.`;

  let raw = '';
  try {
    raw = await client.chat([msg.system(SYSTEM_RERANK), msg.user(user)], { temperature: 0 });
  } catch {
    return fallback(candidates, topK);
  }

  const order = parseRanked(raw, n, limit);
  if (!order) return fallback(candidates, topK);

  const ranked = order.map((oneBased) => candidates[oneBased - 1]);
  // rankDelta = средний сдвиг позиции между исходным cosine-порядком и итогом.
  let deltaSum = 0;
  for (let newPos = 0; newPos < ranked.length; newPos++) {
    const oldPos = candidates.indexOf(ranked[newPos]);
    deltaSum += Math.abs(oldPos - newPos);
  }
  const rankDelta = ranked.length > 0 ? deltaSum / ranked.length : 0;
  return { ranked, fallback: false, rankDelta };
}
