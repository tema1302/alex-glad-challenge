// /api/chat/[sessionId]/branch — branching mutations (web P2b).
// GET → { branches, activeId }. POST → action: checkpoint|switch.
// checkpoint создаёт ветку-снимок активной (НЕ переключает); switch делает ветку активной.
import 'server-only';
import { NextRequest } from 'next/server';
import { branchActionSchema } from '../../../../../lib/shared/forms';
import { branchList, branchCheckpoint, branchSwitch } from '../../../../../lib/server/chat-mutations';
import { safeMessage } from '../../../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ sessionId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const { sessionId } = await ctx.params;
  try {
    return Response.json(await branchList(sessionId));
  } catch (e) {
    return Response.json(
      { error: safeMessage(e instanceof Error ? e.message : 'error') },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { sessionId } = await ctx.params;
  const parsed = branchActionSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  try {
    if (parsed.data.action === 'checkpoint') {
      const { branchId, view } = await branchCheckpoint(sessionId, parsed.data.label);
      return Response.json({ ok: true, branchId, view });
    }
    // switch
    if (parsed.data.id === undefined) {
      return Response.json({ error: 'id обязателен для switch' }, { status: 400 });
    }
    const view = await branchSwitch(sessionId, parsed.data.id);
    return Response.json({ ok: true, view });
  } catch (e) {
    return Response.json(
      { error: safeMessage(e instanceof Error ? e.message : 'error') },
      { status: 500 },
    );
  }
}
