// /api/blogs/[slug] — настройка одного блога. GET → camelCase BlogDto (промпты,
// источники, статус, counts). PATCH {name?, profile?, tgChatId?, stylePreset?,
// status?, systemPrompt?, contextPrompt?, sources?} → обновлённый BlogDto.
// requireApiAuth — cookie-сессия ИЛИ мобильный Bearer-токен. Единственный маппер
// toBlogDto: раньше PATCH отдавал raw BlogRow, из-за чего клиенты теряли поля.
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { blogPatchSchema } from '../../../../lib/shared/forms';
import { requireApiAuth } from '../../../../lib/auth';
import { ProfileManager, dataPath } from '../../../../lib/server/challenge';
import { getBlogDb, withDb } from '../../../../lib/server/db';
import { toBlogDto } from '../../../../lib/server/blogs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function emptyToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  return value.trim() === '' ? null : value;
}

function blogError(slug: string): { error: string; status: number } {
  return { error: `Блог «${slug}» не найден`, status: 404 };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;

  const { slug } = await params;
  const data = await withDb(() => {
    const db = getBlogDb();
    const blog = db.getBlogBySlug(slug);
    if (!blog) return null;
    const names = new ProfileManager(dataPath('profiles')).list();
    return toBlogDto(blog, {
      hasProfile: Boolean(blog.profile && names.includes(blog.profile)),
      stats: db.blogStats(blog.id),
      agentPromptsCount: db.agentPromptsCount(blog.id),
    });
  });
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ blog: data }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;

  const { slug } = await params;
  const parsed = blogPatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  const patch = parsed.data;

  const updated = await withDb(() => {
    const db = getBlogDb();
    const blog = db.getBlogBySlug(slug);
    if (!blog) return blogError(slug);

    if (patch.profile !== undefined && patch.profile !== null) {
      const names = new ProfileManager(dataPath('profiles')).list();
      if (!names.includes(patch.profile)) {
        return { error: `Профиль «${patch.profile}» не найден — создайте его в /chat`, status: 400 };
      }
    }

    if (patch.status !== undefined) {
      db.setBlogArchived(blog.id, patch.status === 'archived');
    }
    db.updateBlog(blog.id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.profile !== undefined ? { profile: patch.profile } : {}),
      ...(patch.tgChatId !== undefined ? { tg_chat_id: patch.tgChatId?.trim() ? patch.tgChatId.trim() : null } : {}),
      ...(patch.stylePreset !== undefined ? { style_preset: patch.stylePreset } : {}),
      ...(patch.sources !== undefined
        ? { sources: patch.sources.length > 0 ? JSON.stringify(patch.sources) : null }
        : {}),
      ...(patch.systemPrompt !== undefined
        ? { system_prompt: emptyToNull(patch.systemPrompt) }
        : {}),
      ...(patch.contextPrompt !== undefined
        ? { context_prompt: emptyToNull(patch.contextPrompt) }
        : {}),
    });

    const fresh = db.getBlogBySlug(slug);
    if (!fresh) return blogError(slug);
    const names = new ProfileManager(dataPath('profiles')).list();
    return toBlogDto(fresh, {
      hasProfile: Boolean(fresh.profile && names.includes(fresh.profile)),
      stats: db.blogStats(fresh.id),
      agentPromptsCount: db.agentPromptsCount(fresh.id),
    });
  });

  if (updated && 'error' in updated) {
    return NextResponse.json({ error: updated.error }, { status: updated.status });
  }
  return NextResponse.json({ ok: true, blog: updated });
}
