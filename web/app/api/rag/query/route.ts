// SSE Route Handler: RAG-query со стримингом токенов + live-стадиями пайплайна.
// День 28, web P1. runtime=nodejs, force-dynamic. Логика server-only: все импорты core/
// идут через web/lib/server/* chokepoint (client bundle физически не получает core/).
//
// Контракт событий (web/lib/shared/sse.ts):
//   {type:'stage',  step, detail}                            — стадии (rewrite/retrieve/filter/rerank/guard/llm)
//   {type:'token',  delta}                                   — токен LLM
//   {type:'done',   answer, sources?, quotes?, debug?}       — финал
//   {type:'error',  message}                                 — обобщённое сообщение БЕЗ URL/ключа/пути
import 'server-only';
import { NextRequest } from 'next/server';

import { ragQuerySchema } from '../../../../lib/shared/forms';
import type { SseEvent, SseSource, SseQuote, SseDebug } from '../../../../lib/shared/sse';
import { pickLlmClient } from '../../../../lib/server/llm';
import { getRagStore, withDb } from '../../../../lib/server/db';
import {
  Retriever,
  makeEmbedder,
  answerWithRag,
  answerNoRag,
} from '../../../../lib/server/challenge';
import type { ScoredChunk } from '../../../../lib/server/challenge';
import { safeMessage } from '../../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  const parsed = ragQuerySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: parsed.error.issues[0]?.message ?? 'invalid request' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const { query, strategy = 'fixed', k, llm = 'local', noRag = false } = parsed.data;
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

        const retriever = new Retriever(getRagStore(), makeEmbedder(), strategy);
        // withDb сериализует обращения к DatabaseSync (store.search синхронен и тяжёл).
        // 1-юзер локально: удержание mutex на время LLM-вызова приемлемо (R4, план §6).
        const result = await withDb(() =>
          answerWithRag(client, retriever, query, {
            k,
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
