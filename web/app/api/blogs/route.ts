// /api/blogs — список всех блогов и создание нового.
// GET: активные по умолчанию; ?includeArchived=1 — вместе с архивом. Отдаёт
// camelCase BlogDto с counts/readiness/agentPromptsCount + список профилей голоса
// для формы создания. POST: create + валидация slug/профиля/источников.
// server-only: core/ через chokepoint, все чтения/записи БД — внутри withDb().
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { blogCreateSchema } from '../../../lib/shared/forms';
import { requireApiAuth } from '../../../lib/auth';
import { ProfileManager, dataPath } from '../../../lib/server/challenge';
import { getBlogDb, withDb } from '../../../lib/server/db';
import { toBlogDto } from '../../../lib/server/blogs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const includeArchived = req.nextUrl.searchParams.get('includeArchived') === '1';
  const data = await withDb(() => {
    const db = getBlogDb();
    const names = new ProfileManager(dataPath('profiles')).list();
    const blogs = db
      .listBlogs()
      .filter((blog) => includeArchived || blog.archived_at === null)
      .map((blog) =>
        toBlogDto(blog, {
          hasProfile: Boolean(blog.profile && names.includes(blog.profile)),
          stats: db.blogStats(blog.id),
          agentPromptsCount: db.agentPromptsCount(blog.id),
        }),
      );
    return { blogs, profiles: names };
  });
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;

  const parsed = blogCreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const result = await withDb(() => {
    const db = getBlogDb();
    if (db.getBlogBySlug(input.slug)) {
      return { error: `Блог со slug «${input.slug}» уже существует`, status: 409 } as const;
    }
    if (input.profile?.trim()) {
      const names = new ProfileManager(dataPath('profiles')).list();
      if (!names.includes(input.profile)) {
        return { error: `Профиль «${input.profile}» не найден — создайте его в /chat`, status: 400 } as const;
      }
    }
    try {
      const blog = db.createBlog({
        slug: input.slug,
        name: input.name,
        profile: input.profile?.trim() || null,
        tg_chat_id: input.tgChatId?.trim() ? input.tgChatId.trim() : null,
        sources: input.sources && input.sources.length > 0 ? JSON.stringify(input.sources) : null,
        style_preset: input.stylePreset ?? 'default',
      });
      const names = new ProfileManager(dataPath('profiles')).list();
      return {
        blog: toBlogDto(blog, {
          hasProfile: Boolean(blog.profile && names.includes(blog.profile)),
          stats: db.blogStats(blog.id),
          agentPromptsCount: 0,
        }),
      } as const;
    } catch (e) {
      // UNIQUE-гонка между проверкой и INSERT; остальные ошибки не маскируем 409.
      if (e instanceof Error && e.message.includes('UNIQUE')) {
        return { error: `Блог со slug «${input.slug}» уже существует`, status: 409 } as const;
      }
      throw e;
    }
  });

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, blog: result.blog }, { status: 201 });
}
