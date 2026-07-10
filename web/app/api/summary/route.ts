// /api/summary — сводка ожидающих задач + опц. публикация в TG (день 28, web P5).
// GET  → getTodoDb().getPendingSummary() (текст). Только чтение.
// POST {publish:true} → если isTelegramConfigured() → publishPost(summary) (Bot API).
//   Гейт как /api/blog/posts/[id]/publish: вызов publishPost ТОЛЬКО при настроенном TG.
//   publish:false || TG не настроен → 400/информативное сообщение (без живой отправки).
// server-only: core/ (TodoDb/publishPost/isTelegramConfigured) через chokepoint.
import 'server-only';
import { NextRequest } from 'next/server';

import { summaryPublishSchema } from '../../../lib/shared/forms';
import { getTodoDb, withDb } from '../../../lib/server/db';
import { publishPost, isTelegramConfigured } from '../../../lib/server/challenge';
import { safeMessage } from '../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const summary = await withDb(() => getTodoDb().getPendingSummary());
  return Response.json({ summary, publishable: isTelegramConfigured() });
}

export async function POST(req: NextRequest): Promise<Response> {
  const parsed = summaryPublishSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  if (!parsed.data.publish) {
    return Response.json({ error: 'Требуется publish:true' }, { status: 400 });
  }
  if (!isTelegramConfigured()) {
    return Response.json(
      { ok: false, error: 'Telegram не настроен (TG_BOT_TOKEN/TG_CHAT_ID не заданы)' },
      { status: 400 },
    );
  }

  const summary = await withDb(() => getTodoDb().getPendingSummary());
  try {
    const result = await publishPost(summary);
    if (!result.ok) {
      return Response.json(
        { ok: false, error: safeMessage(result.error ?? 'publish failed') },
        { status: 502 },
      );
    }
    return Response.json({ ok: true, messageId: result.messageId });
  } catch (e) {
    return Response.json(
      { ok: false, error: safeMessage(e instanceof Error ? e.message : 'publish failed') },
      { status: 502 },
    );
  }
}
