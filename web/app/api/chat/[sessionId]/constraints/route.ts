// /api/chat/[sessionId]/constraints — инварианты mutations (web P2b).
// GET → { items }. POST → action: add|rm. Инварианты глобальны (constraints.json).
import 'server-only';
import { NextRequest } from 'next/server';
import { constraintsActionSchema } from '../../../../../lib/shared/forms';
import { constraintsList, constraintAdd, constraintRemove } from '../../../../../lib/server/chat-mutations';
import { safeMessage } from '../../../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ sessionId: string }> };

export async function GET(_req: NextRequest, _ctx: Ctx): Promise<Response> {
  try {
    return Response.json(await constraintsList());
  } catch (e) {
    return Response.json(
      { error: safeMessage(e instanceof Error ? e.message : 'error') },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { sessionId } = await ctx.params;
  void sessionId; // constraints глобальны; sessionId в пути для консистентности API.
  const parsed = constraintsActionSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  try {
    if (parsed.data.action === 'add') {
      const { type, title, description } = parsed.data;
      if (!type || !title) return err(400, 'type и title обязательны');
      const item = await constraintAdd(type, title, description ?? '');
      return Response.json({ ok: true, item, view: await constraintsList() });
    }
    // rm
    if (!parsed.data.id) return err(400, 'id обязателен');
    await constraintRemove(parsed.data.id);
    return Response.json({ ok: true, view: await constraintsList() });
  } catch (e) {
    return Response.json(
      { error: safeMessage(e instanceof Error ? e.message : 'error') },
      { status: 500 },
    );
  }
}

function err(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}
