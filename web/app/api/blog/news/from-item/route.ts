// POST /api/blog/news/from-item — пост по конкретной новости из топ-списка.
// Не перезапускает RSS и ранжирование: берёт newsId из blog.sqlite, пишет пост
// тем же PostWriter/FactChecker, что и полный news-pipeline, и возвращает id.
// server-only; LLM/БД — через chokepoint web/lib/server/*.
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { newsFromItemSchema } from '../../../../../lib/shared/forms';
import { pickLlmClient } from '../../../../../lib/server/llm';
import { getBlogDb, withDb } from '../../../../../lib/server/db';
import {
  resolveBlog,
  loadBlogProfile,
  blogProfileMissing,
  blogArchivedError,
} from '../../../../../lib/server/blogs';
import {
  runPostFromNews,
  ProfileManager,
  dataPath,
  type BlogRow,
} from '../../../../../lib/server/challenge';
import { safeMessage } from '../../../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const parsed = newsFromItemSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  const { newsId, llm = 'cloud', blog: blogRef } = parsed.data;

  let blog: BlogRow | null = null;
  if (blogRef) {
    const res = resolveBlog(blogRef);
    if (!res.blog) {
      return NextResponse.json({ error: res.error ?? 'blog not found' }, { status: 400 });
    }
    blog = res.blog;
  }

  // Новость и её блог: запрос из UI может не передавать blog (страница в
  // legacy-режиме) — берём владельца новости из БД, чтобы голос не смешался.
  const news = await withDb(() => getBlogDb().getNews(newsId));
  if (!news) return NextResponse.json({ error: 'Новость не найдена' }, { status: 404 });

  if (!blog && news.blog_id !== null) {
    blog = await withDb(() => getBlogDb().getBlog(news.blog_id!));
    if (!blog) {
      return NextResponse.json({ error: 'Блог новости не найден' }, { status: 400 });
    }
  }
  if (blog && news.blog_id !== null && news.blog_id !== blog.id) {
    return NextResponse.json({ error: 'Новость принадлежит другому блогу' }, { status: 400 });
  }
  if (blog) {
    const archived = blogArchivedError(blog);
    if (archived) return NextResponse.json({ error: archived }, { status: 400 });
  }

  const blogProfile = blog ? loadBlogProfile(blog) : null;
  if (blog && !blogProfile) {
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

  const profile =
    blogProfile ??
    (() => {
      const mgr = new ProfileManager(dataPath('profiles'));
      const names = mgr.list();
      if (names.length > 0) {
        mgr.load(names.includes('default') ? 'default' : names[0]);
      } else {
        mgr.create('default');
      }
      return mgr;
    })();

  try {
    const result = await withDb(() =>
      runPostFromNews(getBlogDb(), client, {
        newsId,
        profile,
        ...(blog ? { blog } : {}),
        signal: req.signal,
      }),
    );
    return NextResponse.json({
      ok: true,
      post: { id: result.postId, content: result.post.content },
      verdict: result.factCheck.verdict,
    });
  } catch (e) {
    const message = e instanceof Error ? safeMessage(e.message) : 'internal error';
    const status = /не найдена|другому блогу|в архиве/i.test(message) ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
