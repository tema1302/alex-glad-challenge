// /api/rag/chat — список DialogDb-чатов (GET) и создание (POST). web P3a.
// DialogDb переиспользуем (план §5B) — отдельного session-store не заводим.
// Сессия живёт в dialog.sqlite (history + task_state), переживает reload.
import 'server-only';
import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { ragChatCreateSchema } from '../../../../lib/shared/forms';
import { getDialogDb, withDb } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const chats = await withDb(() => getDialogDb().listChats(100));
  return Response.json({ chats });
}

export async function POST(req: NextRequest): Promise<Response> {
  const parsed = ragChatCreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  const id = crypto.randomUUID();
  await withDb(() => {
    getDialogDb().createChat(id, parsed.data.title?.trim() || 'untitled');
  });
  return Response.json({ id });
}
