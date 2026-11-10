// Unit: GET/PUT /api/blogs/[slug]/agent-prompts — реестр и per-blog override.
// Route не должен отдавать JSON-контракты редактируемыми; writer пишется в
// blogs.system_prompt, остальные — в blog_agent_prompts.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';
process.env.MOBILE_API_TOKEN = 'test-mobile-token';

const MOBILE_TOKEN = 'test-mobile-token';

const mocks = vi.hoisted(() => ({
  getBlogBySlug: vi.fn(),
  updateBlog: vi.fn(),
  listAgentPrompts: vi.fn(),
  getAgentPrompt: vi.fn(),
  setAgentPrompt: vi.fn(),
  clearAgentPrompt: vi.fn(),
  agentPromptsCount: vi.fn(() => 0),
}));

vi.mock('../../lib/server/db', () => ({
  getBlogDb: vi.fn(() => ({
    getBlogBySlug: mocks.getBlogBySlug,
    updateBlog: mocks.updateBlog,
    listAgentPrompts: mocks.listAgentPrompts,
    getAgentPrompt: mocks.getAgentPrompt,
    setAgentPrompt: mocks.setAgentPrompt,
    clearAgentPrompt: mocks.clearAgentPrompt,
    agentPromptsCount: mocks.agentPromptsCount,
  })),
  withDb: vi.fn((fn: () => unknown) => fn()),
}));

const SPECS = [
  {
    id: 'post.writer',
    label: 'Автор поста',
    description: 'Пишет пост',
    defaultPrompt: 'Ты автор',
    maxLength: 8000,
    editableScope: 'роль',
    group: 'content',
  },
  {
    id: 'factcheck.verdict',
    label: 'Фактчекер: вердикт',
    description: 'Вердикт',
    defaultPrompt: 'Ты фактчекер',
    maxLength: 8000,
    editableScope: 'роль',
    group: 'quality',
  },
  {
    id: 'post.topic',
    label: 'Автор по теме',
    description: 'Пост по теме',
    defaultPrompt: 'Ты автор темы',
    maxLength: 8000,
    editableScope: 'роль',
    group: 'content',
  },
];

vi.mock('../../lib/server/challenge', () => ({
  BLOG_AGENT_SPECS: SPECS,
  findBlogAgentSpec: (id: string) => SPECS.find((s) => s.id === id) ?? null,
  clean: (s: string, max: number) => s.slice(0, max),
  resolveBlogAgentPrompt: (
    db: { getAgentPrompt: (blogId: number, agent: string) => { prompt: string } | null },
    blog: { id: number; system_prompt: string | null } | null,
    agent: string,
  ) => {
    if (!blog) return { agent, prompt: null, source: 'default' };
    const row = db.getAgentPrompt(blog.id, agent);
    if (row) {
      const stored = row.prompt.trim();
      if (stored) return { agent, prompt: stored, source: 'blog' };
      return { agent, prompt: null, source: 'default' };
    }
    if ((agent === 'post.writer' || agent === 'post.topic') && blog.system_prompt?.trim()) {
      return { agent, prompt: blog.system_prompt.trim(), source: 'legacy-blog-system' };
    }
    return { agent, prompt: null, source: 'default' };
  },
}));

let GET: (req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => Promise<Response>;
let PUT: (req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => Promise<Response>;

beforeAll(async () => {
  ({ GET, PUT } = await import('../../app/api/blogs/[slug]/agent-prompts/route'));
});

type Ctx = { params: Promise<{ slug: string }> };
function ctx(slug = 'main'): Ctx {
  return { params: Promise.resolve({ slug }) };
}

function req(method: string, body?: unknown, auth = true): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth) headers.authorization = `Bearer ${MOBILE_TOKEN}`;
  return new NextRequest('http://127.0.0.1:3000/api/blogs/main/agent-prompts', {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

let stored = new Map<string, string>();
let blog: Record<string, unknown>;

beforeEach(() => {
  stored = new Map();
  blog = {
    id: 1,
    slug: 'main',
    name: 'Главный',
    system_prompt: null,
    context_prompt: null,
    archived_at: null,
  };
  mocks.getBlogBySlug.mockReset().mockImplementation(() => blog);
  mocks.updateBlog.mockReset().mockImplementation((_id: number, patch: Record<string, unknown>) => {
    Object.assign(blog, patch);
  });
  mocks.listAgentPrompts.mockReset().mockImplementation(() =>
    [...stored.entries()].map(([agent, prompt]) => ({ agent, prompt, updated_at: '2026-11-10T00:00:00Z' })),
  );
  mocks.getAgentPrompt.mockReset().mockImplementation((_id: number, agent: string) => {
    if (!stored.has(agent)) return null;
    const prompt = stored.get(agent) ?? '';
    return { prompt, updated_at: '2026-11-10T00:00:00Z' };
  });
  mocks.setAgentPrompt.mockReset().mockImplementation((_id: number, agent: string, prompt: string) => {
    stored.set(agent, prompt);
  });
  mocks.clearAgentPrompt.mockReset().mockImplementation((_id: number, agent: string) => stored.delete(agent));
});

describe('GET /api/blogs/[slug]/agent-prompts', () => {
  it('без auth → 401', async () => {
    const res = await GET(req('GET', undefined, false), ctx());
    expect(res.status).toBe(401);
  });

  it('неизвестный блог → 404', async () => {
    mocks.getBlogBySlug.mockReturnValue(null);
    const res = await GET(req('GET'), ctx('ghost'));
    expect(res.status).toBe(404);
  });

  it('отдаёт реестр с default/effective/source', async () => {
    const res = await GET(req('GET'), ctx());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { prompts: Array<Record<string, unknown>> };
    expect(json.prompts).toHaveLength(SPECS.length);
    expect(json.prompts[0]).toMatchObject({
      agent: 'post.writer',
      label: 'Автор поста',
      prompt: null,
    });
    expect(json.prompts[0]).toMatchObject({
      defaultPrompt: 'Ты автор',
      effectivePrompt: 'Ты автор',
      source: 'default',
      isOverridden: false,
      maxLength: 8000,
    });
  });

  it('legacy system_prompt показывается как override автора', async () => {
    blog.system_prompt = 'Легаси-промпт';
    const res = await GET(req('GET'), ctx());
    const json = (await res.json()) as { prompts: Array<Record<string, unknown>> };
    expect(json.prompts[0]).toMatchObject({
      prompt: 'Легаси-промпт',
      source: 'legacy-blog-system',
      isOverridden: true,
    });
  });
});

describe('PUT /api/blogs/[slug]/agent-prompts', () => {
  it('без auth → 401', async () => {
    const res = await PUT(req('PUT', { agent: 'factcheck.verdict', prompt: 'x' }, false), ctx());
    expect(res.status).toBe(401);
  });

  it('неизвестный агент → 400', async () => {
    const res = await PUT(req('PUT', { agent: 'nope', prompt: 'x' }), ctx());
    expect(res.status).toBe(400);
    expect(mocks.setAgentPrompt).not.toHaveBeenCalled();
  });

  it('промпт > 8000 → 400', async () => {
    const res = await PUT(req('PUT', { agent: 'factcheck.verdict', prompt: 'x'.repeat(8001) }), ctx());
    expect(res.status).toBe(400);
  });

  it('неизвестный блог → 404', async () => {
    mocks.getBlogBySlug.mockReturnValue(null);
    const res = await PUT(req('PUT', { agent: 'factcheck.verdict', prompt: 'x' }), ctx('ghost'));
    expect(res.status).toBe(404);
  });

  it('factcheck.verdict пишется в blog_agent_prompts', async () => {
    const res = await PUT(req('PUT', { agent: 'factcheck.verdict', prompt: 'Строгий вердикт' }), ctx());
    expect(res.status).toBe(200);
    expect(mocks.setAgentPrompt).toHaveBeenCalledWith(1, 'factcheck.verdict', 'Строгий вердикт');
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      prompt: { agent: 'factcheck.verdict', prompt: 'Строгий вердикт', source: 'blog', isOverridden: true },
    });
  });

  it('post.writer пишется в blogs.system_prompt (легаси-совместимость)', async () => {
    const res = await PUT(req('PUT', { agent: 'post.writer', prompt: 'Новый автор' }), ctx());
    expect(res.status).toBe(200);
    expect(mocks.updateBlog).toHaveBeenCalledWith(1, { system_prompt: 'Новый автор' });
    expect(mocks.setAgentPrompt).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      prompt: { agent: 'post.writer', prompt: 'Новый автор', source: 'legacy-blog-system' },
    });
  });

  it('prompt=null сбрасывает override', async () => {
    stored.set('factcheck.verdict', 'старый');
    const res = await PUT(req('PUT', { agent: 'factcheck.verdict', prompt: null }), ctx());
    expect(res.status).toBe(200);
    expect(mocks.clearAgentPrompt).toHaveBeenCalledWith(1, 'factcheck.verdict');
    await expect(res.json()).resolves.toMatchObject({
      prompt: { agent: 'factcheck.verdict', prompt: null, source: 'default' },
    });
  });

  it('пустая строка сбрасывает override', async () => {
    const res = await PUT(req('PUT', { agent: 'factcheck.verdict', prompt: '   ' }), ctx());
    expect(res.status).toBe(200);
    expect(mocks.clearAgentPrompt).toHaveBeenCalledWith(1, 'factcheck.verdict');
  });

  it('reset post.topic при system_prompt ставит tombstone, а не подхватывает legacy', async () => {
    blog.system_prompt = 'Промпт автора';
    const res = await PUT(req('PUT', { agent: 'post.topic', prompt: null }), ctx());
    expect(res.status).toBe(200);
    expect(mocks.setAgentPrompt).toHaveBeenCalledWith(1, 'post.topic', '');
    expect(mocks.clearAgentPrompt).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      prompt: { agent: 'post.topic', prompt: null, source: 'default', isOverridden: false },
    });
  });
});
