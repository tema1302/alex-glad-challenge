// /api/chat/[sessionId] — chat-реплика (POST SSE), загрузка (GET), обновление (PATCH). web P2.
// POST: SSE {token → done(usage)} | error. Контракт событий — web/lib/shared/sse.ts.
// zod на входе; safeMessage обобщает error без секрета/URL/пути.
import 'server-only';
import { NextRequest } from 'next/server';
import { chatSendSchema, chatSessionUpdateSchema } from '../../../../lib/shared/forms';
import type { SseEvent } from '../../../../lib/shared/sse';
import { executeChat } from '../../../../lib/server/chat-adapter';
import { getWebSessionStore } from '../../../../lib/server/web-session-store';
import { withDb } from '../../../../lib/server/db';
import { safeMessage } from '../../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ sessionId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const { sessionId } = await ctx.params;
  const data = await withDb(() => getWebSessionStore().load(sessionId));
  if (!data) return Response.json({ error: 'Сессия не найдена' }, { status: 404 });
  return Response.json({ session: data });
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { sessionId } = await ctx.params;
  const parsed = chatSendSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: SseEvent): void => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };
      try {
        for await (const ev of executeChat(sessionId, parsed.data.text, { llm: parsed.data.llm, signal: req.signal })) {
          send(ev);
        }
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

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { sessionId } = await ctx.params;
  const parsed = chatSessionUpdateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  const { reset, ...patch } = parsed.data;
  await withDb(() => {
    const s = getWebSessionStore();
    if (reset) {
      s.clearMessages(sessionId);
      s.updateSession(sessionId, { usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
      return;
    }
    s.updateSession(sessionId, patch);
  });
  const data = await withDb(() => getWebSessionStore().load(sessionId));
  if (!data) return Response.json({ error: 'Сессия не найдена' }, { status: 404 });
  return Response.json({ session: data });
}
