// /api/chat/[sessionId]/memory — mutations 3-слойной памяти (web P2b).
// GET → snapshot (longTerm глобальный + per-session task/working/memoryEnabled).
// POST → action: remember|forget|task|task-add|task-clear|fact-rm|on|off.
// remember/task/task-add имеют side-effect: memory mode ON (parity с repl.ts).
import 'server-only';
import { NextRequest } from 'next/server';
import { memoryActionSchema } from '../../../../../lib/shared/forms';
import {
  memorySnapshot,
  memoryRemember,
  memoryForget,
  memorySetTask,
  memoryAddFact,
  memoryRemoveFact,
  memoryClearWorking,
  memorySetEnabled,
} from '../../../../../lib/server/chat-mutations';
import { safeMessage } from '../../../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ sessionId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const { sessionId } = await ctx.params;
  try {
    return Response.json(await memorySnapshot(sessionId));
  } catch (e) {
    return Response.json(
      { error: safeMessage(e instanceof Error ? e.message : 'error') },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { sessionId } = await ctx.params;
  const parsed = memoryActionSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  const { action, key, value, description } = parsed.data;
  try {
    switch (action) {
      case 'remember':
        if (!key || value === undefined) return err(400, 'key и value обязательны');
        await memoryRemember(sessionId, key, value);
        break;
      case 'forget':
        if (!key) return err(400, 'key обязателен');
        await memoryForget(sessionId, key);
        break;
      case 'task':
        if (!description) return err(400, 'description обязателен');
        await memorySetTask(sessionId, description);
        break;
      case 'task-add':
        if (!key || value === undefined) return err(400, 'key и value обязательны');
        await memoryAddFact(sessionId, key, value);
        break;
      case 'fact-rm':
        if (!key) return err(400, 'key обязателен');
        await memoryRemoveFact(sessionId, key);
        break;
      case 'task-clear':
        await memoryClearWorking(sessionId);
        break;
      case 'on':
        await memorySetEnabled(sessionId, true);
        break;
      case 'off':
        await memorySetEnabled(sessionId, false);
        break;
    }
    return Response.json({ ok: true, view: await memorySnapshot(sessionId) });
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
