// /api/summary — сводка ожидающих задач + опц. публикация в TG (ТЗ §8.6 cutover).
// GET  → getTodoDb().getPendingSummary() (текст) + publishable-флаг. Только чтение.
// POST {publish:true} → единый helper publishToTelegram('summary') [гейт TG-env →
//   chokepoint → outbox → карта ошибок]. requireAuth — второй auth-слой.
// server-only: core/ через chokepoint.
import 'server-only';
import { NextRequest } from 'next/server';

import { summaryPublishSchema } from '../../../lib/shared/forms';
import { getTodoDb, withDb } from '../../../lib/server/db';
import { isTelegramConfigured } from '../../../lib/server/challenge';
import { requireAuth } from '../../../lib/auth';
import { publishToTelegram, tgPublishResponse } from '../../../lib/server/tg-publish';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const summary = await withDb(() => getTodoDb().getPendingSummary());
  return Response.json({ summary, publishable: isTelegramConfigured() });
}

export async function POST(req: NextRequest): Promise<Response> {
  const denied = requireAuth(req);
  if (denied) return denied;

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

  const summary = await withDb(() => getTodoDb().getPendingSummary());
  const outcome = await publishToTelegram(summary, 'summary');
  return tgPublishResponse(outcome);
}
