// /api/chat/[sessionId]/profile — profile mutations (web P2b).
// GET → { profiles, active, snapshot }. POST → action: use|edit|new|copy|delete|reset|note.
// edit — async (LLM editViaLLM), возвращает { ok, summary }. instruction sanitize через clean().
import 'server-only';
import { NextRequest } from 'next/server';
import { profileActionSchema } from '../../../../../lib/shared/forms';
import {
  profileList,
  profileUse,
  profileEdit,
  profileNew,
  profileCopy,
  profileDelete,
  profileReset,
  profileNote,
} from '../../../../../lib/server/chat-mutations';
import { safeMessage } from '../../../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ sessionId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const { sessionId } = await ctx.params;
  try {
    return Response.json(await profileList(sessionId));
  } catch (e) {
    return Response.json(
      { error: safeMessage(e instanceof Error ? e.message : 'error') },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { sessionId } = await ctx.params;
  const parsed = profileActionSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  const { action, name, base, instruction, text, llm } = parsed.data;
  try {
    switch (action) {
      case 'use':
        if (!name) return err(400, 'name обязателен');
        await profileUse(sessionId, name);
        return Response.json({ ok: true, view: await profileList(sessionId) });
      case 'edit': {
        if (!instruction) return err(400, 'instruction обязательна');
        const summary = await profileEdit(sessionId, instruction, llm ?? 'local');
        return Response.json({ ok: true, summary, view: await profileList(sessionId) });
      }
      case 'new':
        if (!name) return err(400, 'name обязателен');
        await profileNew(sessionId, name, base);
        return Response.json({ ok: true, view: await profileList(sessionId) });
      case 'copy':
        if (!name) return err(400, 'name обязателен (новое имя)');
        await profileCopy(sessionId, name);
        return Response.json({ ok: true, view: await profileList(sessionId) });
      case 'delete':
        if (!name) return err(400, 'name обязателен');
        await profileDelete(sessionId, name);
        return Response.json({ ok: true, view: await profileList(sessionId) });
      case 'reset':
        await profileReset(sessionId);
        return Response.json({ ok: true, view: await profileList(sessionId) });
      case 'note':
        if (!text) return err(400, 'text обязателен');
        await profileNote(sessionId, text);
        return Response.json({ ok: true, view: await profileList(sessionId) });
    }
  } catch (e) {
    return Response.json(
      { error: safeMessage(e instanceof Error ? e.message : 'error') },
      { status: 500 },
    );
  }
  return Response.json({ error: 'unknown action' }, { status: 400 });
}

function err(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}
