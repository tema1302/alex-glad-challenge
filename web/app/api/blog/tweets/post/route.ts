// POST /api/blog/tweets/post — пост в стиле Антонова из сохранённого твита блогера.
// Берёт твит из tweets (по DB id / URL / snowflake-ID), пишет тем же PostWriter+FactChecker
// (пресет antonov через блог lookatfacts), сохраняет в posts (topic=URL твита).
// server-only; LLM/БД/профиль — через chokepoint web/lib/server/*.
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { tweetPostSchema } from '../../../../../lib/shared/forms';
import { pickLlmClient } from '../../../../../lib/server/llm';
import { getBlogDb, withDb } from '../../../../../lib/server/db';
import {
  resolveBlog,
  loadBlogProfile,
  blogProfileMissing,
  blogArchivedError,
} from '../../../../../lib/server/blogs';
import { writePostFromTweet } from '../../../../../lib/server/challenge';
import { resolveTweetRow } from '../../../../../lib/server/tweets';
import { safeMessage } from '../../../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const parsed = tweetPostSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  const { tweet: tweetRef, blog: blogRef, llm = 'cloud', factCheck, chart } = parsed.data;

  const res = resolveBlog(blogRef);
  if (!res.blog) {
    return NextResponse.json({ error: res.error ?? 'blog not found' }, { status: 400 });
  }
  const blog = res.blog;
  const archived = blogArchivedError(blog);
  if (archived) return NextResponse.json({ error: archived }, { status: 400 });

  const tweet = await withDb(() => resolveTweetRow(getBlogDb(), tweetRef));
  if (!tweet) {
    return NextResponse.json({ error: 'Твит не найден в БД — сначала сохраните твит в разделе твитов' }, { status: 404 });
  }

  const blogProfile = loadBlogProfile(blog);
  if (!blogProfile) {
    return NextResponse.json({ error: blogProfileMissing(blog) }, { status: 400 });
  }

  let clientError: string | null = null;
  const client = (() => {
    try {
      return pickLlmClient(llm);
    } catch (e) {
      clientError = e instanceof Error ? safeMessage(e.message) : 'LLM не настроен';
      return null;
    }
  })();
  if (!client) {
    return NextResponse.json({ error: clientError ?? 'LLM не настроен' }, { status: 503 });
  }

  try {
    const result = await withDb(() =>
      writePostFromTweet(getBlogDb(), client, tweet, {
        blog,
        profile: blogProfile,
        chartDescription: chart,
        factCheck,
        signal: req.signal,
      }),
    );
    return NextResponse.json({
      ok: true,
      post: { id: result.postId, content: result.post.content },
      verdict: result.factCheck?.verdict ?? null,
    });
  } catch (e) {
    const message = e instanceof Error ? safeMessage(e.message) : 'internal error';
    const status = /в архиве|не найден/i.test(message) ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}