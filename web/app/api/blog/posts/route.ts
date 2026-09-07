// /api/blog/posts — список постов (день 28, web P4a; ТЗ §8.4 + TG-статус §7.3).
// GET ?limit= → recentPosts(limit) (1..100, default 20) + tg-статус каждого поста
// (join с outbox по blog_post_id: последняя запись ok/error). server-only.
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { getBlogDb, withDb } from '../../../../lib/server/db';
import { getOutboxDb } from '../../../../lib/server/outbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface PostTgStatus {
  status: 'ok' | 'error';
  messageId: number | null;
  createdAt: string;
  error: string | null;
}

export async function GET(req: NextRequest): Promise<Response> {
  const raw = req.nextUrl.searchParams.get('limit');
  const parsed = Number(raw ?? '20');
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed) || 20, 1), 100) : 20;
  const posts = await withDb(() => {
    const rows = getBlogDb().recentPosts(limit);
    const outbox = getOutboxDb();
    return rows.map((p) => {
      const tg = outbox.latestForPost(p.id);
      return {
        ...p,
        tg: tg
          ? {
              status: tg.status,
              messageId: tg.message_id,
              createdAt: tg.created_at,
              error: tg.error,
            }
          : null,
      };
    });
  });
  return NextResponse.json({ posts });
}
