// /api/chat — список сессий (GET) и создание (POST). web P2.
// import 'server-only' не нужен: Next Route Handler на nodejs-runtime и так server-only,
// но для единообразия с chokepoint-дисциплиной — явно. Все core/доступ — через web/lib/server/*.
import 'server-only';
import { NextRequest } from 'next/server';
import { getWebSessionStore } from '../../../lib/server/web-session-store';
import { withDb } from '../../../lib/server/db';
import { chatSessionCreateSchema } from '../../../lib/shared/forms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const list = await withDb(() => getWebSessionStore().listSessions());
  return Response.json({ sessions: list });
}

export async function POST(req: NextRequest): Promise<Response> {
  const parsed = chatSessionCreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  const id = await withDb(() => getWebSessionStore().createSession({
    strategy: parsed.data.strategy,
    system: parsed.data.system,
    windowSize: parsed.data.windowSize,
    memoryEnabled: parsed.data.memoryEnabled,
  }));
  return Response.json({ id });
}
