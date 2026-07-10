// /api/blog/style — образцы стиля для блог-pipeline (день 28, web P4a).
// GET → styleSamples(50). POST {text} → addStyleSample(text) (false при UNIQUE-конфликте).
// server-only: core/ (BlogDb) через chokepoint.
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { styleSampleSchema } from '../../../../lib/shared/forms';
import { getBlogDb, withDb } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const samples = await withDb(() => getBlogDb().styleSamples(50));
  return NextResponse.json({ samples });
}

export async function POST(req: NextRequest): Promise<Response> {
  const parsed = styleSampleSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  // addStyleSample возвращает false при UNIQUE-конфликте — не ошибка, а дубликат.
  const added = await withDb(() => getBlogDb().addStyleSample(parsed.data.text));
  return NextResponse.json({ ok: added, duplicated: !added }, { status: added ? 201 : 200 });
}
