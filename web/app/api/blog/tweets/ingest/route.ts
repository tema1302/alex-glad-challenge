// POST /api/blog/tweets/ingest — ингест твита блогера: по URL/ID (fxtwitter) или
// manual (author+text, офлайн). Сохраняет в tweets + профиль автора, возвращает DTO.
// server-only; БД/сервис — через chokepoint web/lib/server/*. Новый /api/* закрыт middleware.
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { tweetIngestSchema } from '../../../../../lib/shared/forms';
import { getBlogDb, withDb } from '../../../../../lib/server/db';
import { resolveBlog, blogArchivedError } from '../../../../../lib/server/blogs';
import { ingestTweet, ingestManualTweet } from '../../../../../lib/server/challenge';
import { toTweetDto } from '../../../../../lib/server/tweets';
import { safeMessage } from '../../../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const parsed = tweetIngestSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  const d = parsed.data;
  const res = resolveBlog(d.blog);
  if (!res.blog) {
    return NextResponse.json({ error: res.error ?? 'blog not found' }, { status: 400 });
  }
  const blog = res.blog;
  const archived = blogArchivedError(blog);
  if (archived) return NextResponse.json({ error: archived }, { status: 400 });

  try {
    const result = await withDb(async () => {
      const db = getBlogDb();
      if (d.url) return ingestTweet(db, d.url, { blogId: blog.id });
      return ingestManualTweet(
        db,
        {
          authorHandle: d.author!,
          authorName: d.name,
          text: d.text!,
          publishedAt: d.date,
          likes: d.likes,
          retweets: d.retweets,
          replies: d.replies,
          quotes: d.quotes,
          views: d.views,
          bookmarks: d.bookmarks,
        },
        blog.id,
      );
    });
    return NextResponse.json(
      { ok: true, isNew: result.isNew, tweet: toTweetDto(result.tweet) },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    const message = e instanceof Error ? safeMessage(e.message) : 'internal error';
    const status = /Не ссылка|обязательны|не найден/i.test(message) ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}