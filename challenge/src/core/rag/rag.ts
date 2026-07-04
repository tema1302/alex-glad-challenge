// RAG-агент (день 22): два режима — с RAG (контекст из индекса) и без RAG (общие знания).
// ЛLM — строго локальная (makeLocalLlmClient).

import type { LlmClient } from '../client.js';
import { msg } from '../types.js';
import type { ScoredChunk } from './types.js';
import type { Retriever } from './retriever.js';

// Фиксация языка вынесена в НАЧАЛО промпта: qwen2.5:7b-instruct склонен дрейфить
// в zh, короткой фразы в конце недостаточно. Явный запрет доп. языков обязателен.
const SYSTEM_RAG =
  'Отвечай ТОЛЬКО на русском языке. Использовать китайский и любые другие языки запрещено. ' +
  'Ты — ассистент с базой знаний. Отвечай на вопрос СТРОГО по предоставленному контексту. ' +
  'Если в контексте нет ответа — так и скажи: «в базе нет точного ответа». ' +
  'Цитируй источники в виде [n], ссылаясь на номер фрагмента.';

const SYSTEM_NO_RAG =
  'Отвечай ТОЛЬКО на русском языке. Использовать китайский и любые другие языки запрещено. ' +
  'Ты — ассистент. Отвечай из общих знаний, без внешнего контекста.';

// Минимальный косинусный скор чанка для попадания в промпт. Подобран так, чтобы
// не обрезать валидные совпадения (0.7+), но отсечь шум ретривера (топ-K всегда
// что-то вернёт, даже для нерелевантного запроса).
const MIN_RELEVANCE_SCORE = 0.5;

export function buildRagPrompt(question: string, chunks: ScoredChunk[]) {
  const relevant = chunks.filter((c) => c.score >= MIN_RELEVANCE_SCORE);
  if (relevant.length === 0) {
    return [
      msg.system(SYSTEM_RAG),
      msg.user(`В базе знаний нет релевантных фрагментов по этому вопросу.\n\nВопрос: ${question}`),
    ];
  }
  const ctx = relevant
    .map((c, i) => {
      const m = c.chunk.metadata;
      return `[${i + 1}] source=${m.source} | section=${m.section} | score=${c.score.toFixed(3)}\n${c.chunk.text}`;
    })
    .join('\n\n---\n\n');
  return [
    msg.system(SYSTEM_RAG),
    msg.user(`Контекст из базы знаний:\n${ctx}\n\nВопрос: ${question}`),
  ];
}

export interface RagAnswer {
  answer: string;
  sources: ScoredChunk[];
}

export async function answerWithRag(
  client: LlmClient,
  retriever: Retriever,
  question: string,
  k = 4,
): Promise<RagAnswer> {
  const sources = await retriever.retrieve(question, k);
  const answer = await client.chat(buildRagPrompt(question, sources));
  return { answer, sources };
}

export async function answerNoRag(client: LlmClient, question: string): Promise<string> {
  return client.chat([msg.system(SYSTEM_NO_RAG), msg.user(question)]);
}
