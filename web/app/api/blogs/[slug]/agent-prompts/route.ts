// /api/blogs/[slug]/agent-prompts — промпты всех блог-агентов per-blog.
// GET: реестр агентов + текущий override/источник/effective prompt.
// PUT {agent, prompt: string|null}: prompt=null/'' сбрасывает override.
// post.writer хранится в blogs.system_prompt (легаси-совместимость с Android/TG);
// остальные — в blog_agent_prompts. JSON-контракты агентов не редактируются.
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { blogAgentPromptPutSchema } from '../../../../../lib/shared/forms';
import { requireApiAuth } from '../../../../../lib/auth';
import {
  BLOG_AGENT_SPECS,
  clean,
  findBlogAgentSpec,
  resolveBlogAgentPrompt,
} from '../../../../../lib/server/challenge';
import { getBlogDb, withDb } from '../../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function promptItem(
  spec: (typeof BLOG_AGENT_SPECS)[number],
  row: { prompt: string; updated_at: string } | null,
  resolved: ReturnType<typeof resolveBlogAgentPrompt>,
): Record<string, unknown> {
  const custom = resolved.source === 'blog' || resolved.source === 'legacy-blog-system'
    ? resolved.prompt
    : null;
  return {
    agent: spec.id,
    label: spec.label,
    description: spec.description,
    group: spec.group,
    defaultPrompt: spec.defaultPrompt,
    prompt: custom,
    effectivePrompt: resolved.prompt ?? spec.defaultPrompt,
    source: resolved.source,
    isOverridden: custom !== null,
    updatedAt: row?.updated_at ?? null,
    maxLength: spec.maxLength,
    editableScope: spec.editableScope,
  };
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
    const rows = new Map(db.listAgentPrompts(blog.id).map((r) => [r.agent, r]));
    return {
      blog: { slug: blog.slug, name: blog.name },
      prompts: BLOG_AGENT_SPECS.map((spec) => {
        const resolved = resolveBlogAgentPrompt(db, blog, spec.id);
        return promptItem(spec, rows.get(spec.id) ?? null, resolved);
      }),
    };
  });
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;

  const { slug } = await params;
  const parsed = blogAgentPromptPutSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  const spec = findBlogAgentSpec(parsed.data.agent);
  if (!spec) return NextResponse.json({ error: 'unknown agent' }, { status: 400 });

  const prompt = parsed.data.prompt === null ? null : clean(parsed.data.prompt, spec.maxLength).trim() || null;

  const result = await withDb(() => {
    const db = getBlogDb();
    const blog = db.getBlogBySlug(slug);
    if (!blog) return null;

    if (spec.id === 'post.writer') {
      // Каноническое хранение автора поста — blogs.system_prompt: его читают
      // старые клиенты (Android PATCH, TG-команды) и легаси-ветка PostWriter.
      db.updateBlog(blog.id, { system_prompt: prompt });
      db.clearAgentPrompt(blog.id, spec.id);
    } else if (prompt === null) {
      db.clearAgentPrompt(blog.id, spec.id);
    } else {
      db.setAgentPrompt(blog.id, spec.id, prompt);
    }

    const fresh = db.getBlogBySlug(slug);
    if (!fresh) return null;
    const row = db.getAgentPrompt(fresh.id, spec.id);
    return {
      ok: true,
      blog: { slug: fresh.slug, name: fresh.name },
      prompt: promptItem(spec, row ?? null, resolveBlogAgentPrompt(db, fresh, spec.id)),
    };
  });

  if (!result) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(result);
}
