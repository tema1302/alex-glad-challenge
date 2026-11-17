// GET /api/blog/tweets/authors — активность авторов за окно (дни): кол-во твитов,
// суммарная популярность. Без сети (чтение БД). server-only; chokepoint web/lib/server/*.
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { tweetAuthorsSchema } from '../../../../../lib/shared/forms';
import { getBlogDb, withDb } from '../../../../../lib/server/db';
import { windowSinceIso, authorActivity } from '../../../../../lib/server/challenge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const parsed = tweetAuthorsSchema.safeParse({
    window: req.nextUrl.searchParams.get('window') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  const days = parsed.data.window ?? 7;
  const authors = await withDb(() =>
    authorActivity(getBlogDb().listTweets({ sinceIso: windowSinceIso(days) })),
  );
  return NextResponse.json(
    { ok: true, window: days, count: authors.length, authors },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}