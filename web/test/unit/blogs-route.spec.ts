// Unit: GET/POST /api/blogs — список всех блогов и создание.
// DB и chokepoint мокаются как граница; auth — реальный (MOBILE_API_TOKEN).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';
process.env.MOBILE_API_TOKEN = 'test-mobile-token';

const MOBILE_TOKEN = 'test-mobile-token';

const mocks = vi.hoisted(() => ({
  listBlogs: vi.fn(),
  getBlogBySlug: vi.fn(),
  createBlog: vi.fn(),
  blogStats: vi.fn(),
  agentPromptsCount: vi.fn(),
  listProfiles: vi.fn(),
}));

vi.mock('../../lib/server/db', () => ({
  getBlogDb: vi.fn(() => ({
    listBlogs: mocks.listBlogs,
    getBlogBySlug: mocks.getBlogBySlug,
    createBlog: mocks.createBlog,
    blogStats: mocks.blogStats,
    agentPromptsCount: mocks.agentPromptsCount,
  })),
  withDb: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../../lib/server/challenge', () => ({
  ProfileManager: class {
    list = mocks.listProfiles;
  },
  dataPath: vi.fn((p: string) => p),
}));

let GET: (req: NextRequest) => Promise<Response>;
let POST: (req: NextRequest) => Promise<Response>;

beforeAll(async () => {
  ({ GET, POST } = await import('../../app/api/blogs/route'));
});

function req(method: string, body?: unknown, auth = true): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth) headers.authorization = `Bearer ${MOBILE_TOKEN}`;
  return new NextRequest('http://127.0.0.1:3000/api/blogs', {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function blog(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    slug: 'main',
    name: 'Главный',
    profile: 'default',
    tg_chat_id: null,
    sources: null,
    style_preset: 'default',
    system_prompt: null,
    context_prompt: null,
    archived_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  mocks.listBlogs.mockReset();
  mocks.getBlogBySlug.mockReset();
  mocks.createBlog.mockReset();
  mocks.blogStats.mockReset();
  mocks.agentPromptsCount.mockReset();
  mocks.listProfiles.mockReset();
  mocks.listBlogs.mockReturnValue([
    blog(),
    blog({ id: 2, slug: 'archived', name: 'Архив', archived_at: '2026-11-01T00:00:00Z' }),
  ]);
  mocks.getBlogBySlug.mockReturnValue(null);
  mocks.blogStats.mockReturnValue({
    posts: 3,
    news: 5,
    styleSamples: 1,
    postsLast7Days: 2,
    lastPostAt: '2026-11-09T00:00:00Z',
  });
  mocks.agentPromptsCount.mockReturnValue(1);
  mocks.listProfiles.mockReturnValue(['default']);
});

describe('GET /api/blogs', () => {
  it('по умолчанию отдаёт только активные и counts/readiness', async () => {
    const res = await GET(req('GET'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { blogs: Array<Record<string, unknown>>; profiles: string[] };
    expect(json.blogs).toHaveLength(1);
    expect(json.blogs[0]).toMatchObject({
      slug: 'main',
      status: 'active',
      hasProfile: true,
      sourcesCount: 0,
      readyForNews: false,
      agentPromptsCount: 1,
      counts: { posts: 3, postsLast7Days: 2 },
      lastPostAt: '2026-11-09T00:00:00Z',
    });
    expect(json.profiles).toEqual(['default']);
  });

  it('includeArchived=1 отдаёт архивные блоги со статусом', async () => {
    const res = await GET(new NextRequest('http://127.0.0.1:3000/api/blogs?includeArchived=1'));
    const json = (await res.json()) as { blogs: Array<Record<string, unknown>> };
    expect(json.blogs).toHaveLength(2);
    expect(json.blogs[1]).toMatchObject({ slug: 'archived', status: 'archived' });
  });
});

describe('POST /api/blogs', () => {
  it('без auth → 401', async () => {
    const res = await POST(req('POST', { slug: 'new-blog', name: 'Новый' }, false));
    expect(res.status).toBe(401);
    expect(mocks.createBlog).not.toHaveBeenCalled();
  });

  it('невалидный slug → 400', async () => {
    const res = await POST(req('POST', { slug: 'Плохой Slug', name: 'Новый' }));
    expect(res.status).toBe(400);
    expect(mocks.createBlog).not.toHaveBeenCalled();
  });

  it('несуществующий профиль → 400', async () => {
    const res = await POST(req('POST', { slug: 'new-blog', name: 'Новый', profile: 'ghost' }));
    expect(res.status).toBe(400);
    expect(mocks.createBlog).not.toHaveBeenCalled();
  });

  it('дубль slug → 409', async () => {
    mocks.getBlogBySlug.mockReturnValue(blog());
    const res = await POST(req('POST', { slug: 'main', name: 'Дубль' }));
    expect(res.status).toBe(409);
    expect(mocks.createBlog).not.toHaveBeenCalled();
  });

  it('создаёт блог и отдаёт camelCase DTO', async () => {
    mocks.createBlog.mockImplementation((input: Record<string, unknown>) =>
      blog({
        id: 9,
        slug: input.slug,
        name: input.name,
        profile: input.profile ?? null,
        tg_chat_id: input.tg_chat_id ?? null,
        sources: input.sources ?? null,
        style_preset: input.style_preset ?? 'default',
      }),
    );
    const res = await POST(
      req('POST', {
        slug: 'new-blog',
        name: 'Новый',
        tgChatId: '-1001',
        sources: ['https://a.example/rss'],
        stylePreset: 'antonov',
      }),
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { blog: Record<string, unknown> };
    expect(json.blog).toMatchObject({
      slug: 'new-blog',
      status: 'active',
      sources: ['https://a.example/rss'],
      sourcesCount: 1,
      stylePreset: 'antonov',
      tgChatId: '-1001',
    });
    expect(mocks.createBlog).toHaveBeenCalledWith({
      slug: 'new-blog',
      name: 'Новый',
      profile: null,
      tg_chat_id: '-1001',
      sources: JSON.stringify(['https://a.example/rss']),
      style_preset: 'antonov',
    });
  });
});
