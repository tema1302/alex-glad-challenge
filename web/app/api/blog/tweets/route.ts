// GET /api/blog/tweets — ранжирование сохранённых твитов за окно (дни):
// sort=popularity|discussion|recent, фильтр author/blog, limit. Без сети (чтение БД).
// server-only; БД/скоринг — через chokepoint web/lib/server/*.
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { tweetListSchema } from '../../../../lib/shared/forms';
import { getBlogDb, withDb } from '../../../../lib/server/db';
import { resolveBlog } from '../../../../lib/server/blogs';
import {
  windowSinceIso,
  popularityScore,
  discussionScore,
  type TweetRow,
} from '../../../../lib/server/challenge';
import { toTweetDto } from '../../../../lib/server/tweets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const sp = req.nextUrl.searchParams;
  const parsed = tweetListSchema.safeParse({
    author: sp.get('author') ?? undefined,
    window: sp.get('window') ?? undefined,
    sort: sp.get('sort') ?? undefined,
    limit: sp.get('limit') ?? undefined,
    blog: sp.get('blog') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  const { author, window: win, sort = 'popularity', limit, blog: blogRef } = parsed.data;
  let blogId: number | undefined;
  if (blogRef) {
    const res = resolveBlog(blogRef);
    if (!res.blog) {
      return NextResponse.json({ error: res.error ?? 'blog not found' }, { status: 400 });
    }
    blogId = res.blog.id;
  }
  const days = win ?? 7;
  const tweets = await withDb(() => {
    const rows = getBlogDb().listTweets({ author, sinceIso: windowSinceIso(days), blogId });
    const scoreOf = (t: TweetRow): number =>
      sort === 'discussion' ? discussionScore(t) : popularityScore(t);
    const sorted = sort === 'recent' ? rows : [...rows].sort((a, b) => scoreOf(b) - scoreOf(a));
    return (limit != null ? sorted.slice(0, limit) : sorted).map(toTweetDto);
  });
  return NextResponse.json(
    { ok: true, window: days, sort, count: tweets.length, tweets },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}