// /api/evolute/agent — SSE RAG-агент, скоупированный на TG-чат «Evolute Club |
// Эволют Чат» (forum-топик i-Space 2025). Собран из тех же core-примитивов, что
// /api/rag/query (Retriever + answerWithRag + pickLlmClient через chokepoint),
// отличие: ChatSourceFilter жёстко зафиксирован на chatKey Evolute — агент ищет
// только по этому чату, история диалога приходит от клиента (без DialogDb).
// Схема запроса локальная (не в lib/shared/forms): forms.ts сознательно не
// трогаем. SSE-контракт — web/lib/shared/sse.ts (stage/token/done/error).
import 'server-only';
import { NextRequest } from 'next/server';
import { z } from 'zod';

import type { SseEvent, SseSource, SseQuote, SseDebug } from '../../../../lib/shared/sse';
import { pickLlmClient } from '../../../../lib/server/llm';
import { getRagStore, withDb } from '../../../../lib/server/db';
import {
  Retriever,
  makeEmbedder,
  answerWithRag,
  answerNoRag,
} from '../../../../lib/server/challenge';
import type { ChatMessage, ChatSourceFilter, ScoredChunk } from '../../../../lib/server/challenge';
import { safeMessage } from '../../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// «Evolute Club | Эволют Чат», топик i-Space 2025 (наполняется challenge/update-evolute.ts).
const EVOLUTE_CHAT_KEY = '-1001508192874';

const historyItemSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(8000, 'Слишком длинная реплика в истории'),
});

export const evoluteAgentSchema = z.object({
  query: z.string().trim().min(1, 'Введите вопрос').max(2000, 'Слишком длинный запрос'),
  history: z.array(historyItemSchema).max(20, 'Слишком длинная история').optional(),
  k: z.coerce.number().int().min(1).max(8).optional(),
  llm: z.enum(['local', 'cloud']).optional(),
  noRag: z.boolean().optional(),
});

function toSseSource(s: ScoredChunk): SseSource {
  const m = s.chunk.metadata;
  return {
    chunkId: m.chunkId,
    source: m.source,
    title: m.title,
    section: m.section,
    score: s.score,
  };
}

export async function POST(req: NextRequest): Promise<Response> {
  const parsed = evoluteAgentSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: parsed.error.issues[0]?.message ?? 'invalid request' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const { query, history, k, llm = 'local', noRag = false } = parsed.data;
  const client = pickLlmClient(llm);

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: SseEvent): void => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };
      try {
        if (noRag) {
          let answer = '';
          await answerNoRag(client, query, {
            onToken: (delta) => {
              answer += delta;
              send({ type: 'token', delta });
            },
            signal: req.signal,
          });
          send({ type: 'done', answer });
          return;
        }

        const filter: ChatSourceFilter = { chatKey: EVOLUTE_CHAT_KEY };
        const retriever = new Retriever(getRagStore(), makeEmbedder(), 'telegram', filter);
        // withDb сериализует обращения к DatabaseSync (store.search синхронен и
        // тяжёл) — тот же паттерн, что в /api/rag/query.
        const result = await withDb(() =>
          answerWithRag(client, retriever, query, {
            k,
            history: (history ?? []).map((h): ChatMessage => ({ role: h.role, content: h.content })),
            onProgress: (stage) =>
              send({ type: 'stage', step: stage.step, detail: stage.detail }),
            onToken: (delta) => send({ type: 'token', delta }),
            signal: req.signal,
          }),
        );

        const sources: SseSource[] = result.sources.map(toSseSource);
        const quotes: SseQuote[] | undefined = result.quotes?.map((q) => ({
          chunkId: q.chunkId,
          source: q.source,
          section: q.section,
          snippet: q.snippet,
        }));
        const debug: SseDebug = {
          poolSize: result.debug?.poolSize ?? 0,
          filteredSize: result.debug?.filteredSize ?? 0,
          threshold: result.debug?.threshold ?? 0,
          rerankApplied: result.debug?.rerankApplied ?? false,
          fallback: result.debug?.fallback ?? false,
          rankDelta: result.debug?.rankDelta ?? 0,
          rewritten: result.debug?.rewritten ?? false,
          effectiveQuery: result.debug?.effectiveQuery,
          gaveUp: result.debug?.gaveUp ?? false,
          topK: result.sources.length,
        };
        send({ type: 'done', answer: result.answer, sources, quotes, debug });
      } catch (e) {
        const message = e instanceof Error ? safeMessage(e.message) : 'internal error';
        send({ type: 'error', message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
