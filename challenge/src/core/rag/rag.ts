// RAG-агент (день 22): два режима — с RAG (контекст из индекса) и без RAG (общие знания).
// ЛLM — строго локальная (makeLocalLlmClient).

import type { LlmClient } from '../client.js';
import { msg } from '../types.js';
import type { ScoredChunk } from './types.js';
import type { Retriever } from './retriever.js';

const SYSTEM_RAG =
  'Ты — ассистент с базой знаний. Отвечай на вопрос СТРОГО по предоставленному контексту. ' +
  'Если в контексте нет ответа — так и скажи: «в базе нет точного ответа». ' +
  'Цитируй источники в виде [n], ссылаясь на номер фрагмента. Отвечай на русском.';

const SYSTEM_NO_RAG =
  'Ты — ассистент. Отвечай на русском из общих знаний, без внешнего контекста.';

export function buildRagPrompt(question: string, chunks: ScoredChunk[]) {
  const ctx = chunks
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
