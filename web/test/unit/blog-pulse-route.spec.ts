// Unit: GET /api/blog/pulse — агрегат пульса контента.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';
process.env.MOBILE_API_TOKEN = 'test-mobile-token';

const MOBILE_TOKEN = 'test-mobile-token';

const mocks = vi.hoisted(() => ({
  listBlogs: vi.fn(),
  blogStats: vi.fn(),
  agentPromptsCount: vi.fn(),
  listProfiles: vi.fn(),
}));

vi.mock('../../lib/server/db', () => ({
  getBlogDb: vi.fn(() => ({
    listBlogs: mocks.listBlogs,
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

beforeAll(async () => {
  ({ GET } = await import('../../app/api/blog/pulse/route'));
});

function req(auth = true): NextRequest {
  const headers: Record<string, string> = {};
  if (auth) headers.authorization = `Bearer ${MOBILE_TOKEN}`;
  return new NextRequest('http://127.0.0.1:3000/api/blog/pulse', { method: 'GET', headers });
}

beforeEach(() => {
  mocks.listBlogs.mockReset().mockReturnValue([
    {
      id: 1,
      slug: 'main',
      name: 'Главный',
      profile: 'default',
      sources: JSON.stringify(['https://a.example/rss']),
      archived_at: null,
    },
    {
      id: 2,
      slug: 'church',
      name: 'Храм',
      profile: null,
      sources: null,
      archived_at: null,
    },
    {
      id: 3,
      slug: 'archived',
      name: 'Архив',
      profile: null,
      sources: null,
      archived_at: '2026-11-01T00:00:00Z',
    },
  ]);
  mocks.blogStats.mockReset().mockImplementation((id: number) => ({
    posts: id === 1 ? 4 : 2,
    news: id,
    styleSamples: 1,
    postsLast7Days: id === 1 ? 3 : 0,
    lastPostAt: id === 1 ? '2026-11-09T00:00:00Z' : null,
  }));
  mocks.agentPromptsCount.mockReset().mockReturnValue(1);
  mocks.listProfiles.mockReset().mockReturnValue(['default']);
});

describe('GET /api/blog/pulse', () => {
  it('без auth → 401', async () => {
    const res = await GET(req(false));
    expect(res.status).toBe(401);
  });

  it('отдаёт только активные блоги, totals и readiness', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const json = (await res.json()) as {
      totals: Record<string, number>;
      blogs: Array<Record<string, unknown>>;
    };
    expect(json.blogs).toHaveLength(2);
    expect(json.blogs.map((b) => b.slug)).toEqual(['main', 'church']);
    expect(json.blogs[0]).toMatchObject({
      slug: 'main',
      readyForNews: true,
      hasProfile: true,
      sourcesCount: 1,
      counts: { posts: 4, postsLast7Days: 3 },
      lastPostAt: '2026-11-09T00:00:00Z',
      agentPromptsCount: 1,
    });
    expect(json.blogs[1]).toMatchObject({ slug: 'church', readyForNews: false, sourcesCount: 0 });
    expect(json.totals).toEqual({
      blogs: 2,
      active: 2,
      needsAttention: 1,
      posts: 6,
      postsLast7Days: 3,
      customPrompts: 2,
    });
  });
});
