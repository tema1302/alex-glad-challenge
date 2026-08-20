// SSE Route Handler: RAG index-tg — индексация telegram → rag.sqlite (день 28, web P3b).
// ⚠️ LANDMINE: single-topic (topicId задан) при reset:true чистит ВСЮ telegram-партицию.
// UI /rag/index-tg требует красного warning + confirm-чекбокса для reset.
// POST → start → collect/progress/clear → done | error. MTProto строго server-only.
import 'server-only';
import { NextRequest } from 'next/server';

import { ragIndexTgSchema } from '../../../../lib/shared/forms';
import type { SseRagIndexTgEvent } from '../../../../lib/shared/sse';
import { executeRagIndexTg } from '../../../../lib/server/rag-index-tg-adapter';
import { safeMessage } from '../../../../lib/server/safe-message';
import { requireAuth } from '../../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  // Второй auth-слой (день 36): reset:true сносит telegram-партицию RAG (LANDMINE).
  const denied = requireAuth(req);
  if (denied) return denied;

  const parsed = ragIndexTgSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: parsed.error.issues[0]?.message ?? 'invalid request' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const { chatRef, topicId, reset, limit, top } = parsed.data;

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: SseRagIndexTgEvent): void => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };
      try {
        await executeRagIndexTg(send, chatRef, topicId, { reset, limit, top });
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
