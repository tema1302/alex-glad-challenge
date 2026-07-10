// SSE Route Handler: TG-collect — single-topic MTProto-сбор в tg.sqlite (день 28, web P3b).
// POST → start → progress(onProgress collectTopic) → done | error.
// MTProto/TG_SESSION строго server-only: getConnectedRawScanClient живёт в core/, в client
// bundle не попадает (server-only + chokepoint). zod на входе; error → safeMessage.
//
// Контракт событий (web/lib/shared/sse.ts): SseTgCollectEvent.
import 'server-only';
import { NextRequest } from 'next/server';

import { tgCollectSchema } from '../../../../lib/shared/forms';
import type { SseTgCollectEvent } from '../../../../lib/shared/sse';
import { executeTgCollect } from '../../../../lib/server/tg-collect-adapter';
import { safeMessage } from '../../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const parsed = tgCollectSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: parsed.error.issues[0]?.message ?? 'invalid request' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const { chatRef, topicId, limit, reset } = parsed.data;

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: SseTgCollectEvent): void => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };
      try {
        await executeTgCollect(send, chatRef, topicId, { limit, reset });
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
