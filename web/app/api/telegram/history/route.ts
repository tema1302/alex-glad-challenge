// Route Handler: /api/telegram/history?limit=20 — история публикаций (outbox, ТЗ §7.2).
// Чтение: достаточно middleware-гейта (гость → 401); requireAuth — только для мутаций.
// server-only: outbox через lib/server/outbox (свой singleton, запись — в tg-publish.ts).
import 'server-only';
import { NextRequest } from 'next/server';

import { getOutboxDb } from '../../../../lib/server/outbox';
import { withDb } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const parsed = Number(req.nextUrl.searchParams.get('limit') ?? '20');
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed) || 20, 1), 100) : 20;
  const items = await withDb(() => getOutboxDb().recent(limit));
  return Response.json({ ok: true, items });
}
