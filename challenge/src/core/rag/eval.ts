// Контрольные вопросы для оценки RAG (день 22, усиление).
// 10 вопросов с ожиданием и (опционально) ожидаемыми источниками.
// Хранятся в src/data/rag-eval.json — пользователь редактирует под свой корпус.

import { readFile } from 'node:fs/promises';
import type { LlmClient } from '../client.js';
import { answerNoRag, answerWithRag } from './rag.js';
import type { Retriever } from './retriever.js';
import { formatDuration } from './pipeline.js';

export interface EvalQuestion {
  id: number;
  q: string;
  expectation: string;
  sources?: string[];
}

export interface EvalRow {
  question: EvalQuestion;
  noRag: string;
  withRag: string;
  sources: { source: string; section: string; score: number }[];
}

export async function loadEval(file: string): Promise<EvalQuestion[]> {
  const raw = await readFile(file, 'utf8');
  return JSON.parse(raw) as EvalQuestion[];
}

export async function runEval(
  client: LlmClient,
  retriever: Retriever,
  questions: EvalQuestion[],
  k = 4,
): Promise<EvalRow[]> {
  const rows: EvalRow[] = [];
  const total = questions.length;
  const start = Date.now();
  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    const noRag = await answerNoRag(client, question.q);
    const { answer: withRag, sources } = await answerWithRag(client, retriever, question.q, k);
    rows.push({
      question,
      noRag,
      withRag,
      sources: sources.map((s) => ({
        source: s.chunk.metadata.source,
        section: s.chunk.metadata.section,
        score: s.score,
      })),
    });
    // live-прогресс по контрольным вопросам (2 вызова LLM на каждый),
    // чтобы batch-eval не выглядел зависшим.
    const done = i + 1;
    const pct = total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 100;
    const elapsed = Date.now() - start;
    const rate = done > 0 ? elapsed / done : 0;
    const eta = rate * (total - done);
    console.log(`  [eval ${done}/${total} · ${pct}% · ~${formatDuration(eta)} left]`);
  }
  return rows;
}
