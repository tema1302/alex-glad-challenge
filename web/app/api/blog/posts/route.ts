// /api/blog/posts — список постов (день 28, web P4a).
// GET ?limit= → recentPosts(limit) (1..100, default 20). server-only: core/ через chokepoint.
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { getBlogDb, withDb } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const raw = req.nextUrl.searchParams.get('limit');
  const parsed = Number(raw ?? '20');
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed) || 20, 1), 100) : 20;
  const posts = await withDb(() => getBlogDb().recentPosts(limit));
  return NextResponse.json({ posts });
}
