// Unit: POST /api/blog/news — легаси-семантика sources=null для блога по умолчанию.
// blogs.sources=null в core-пайплайне означает «дефолтные футбольные фиды»
// (challenge/src/core/agents/pipeline.ts), поэтому блог lookatfacts с sources=null
// не должен получать 400. Остальные блоги без источников по-прежнему отклоняются.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getBlogBySlug: vi.fn(),
  recentPosts: vi.fn(),
  runNewsPipeline: vi.fn(),
}));

vi.mock('../../lib/server/db', () => ({
  getBlogDb: vi.fn(() => ({
    getBlogBySlug: mocks.getBlogBySlug,
    recentPosts: mocks.recentPosts,
  })),
  withDb: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../../lib/server/challenge', () => ({
  DEFAULT_BLOG_SLUG: 'lookatfacts',
  dataPath: vi.fn((p: string) => p),
  runNewsPipeline: mocks.runNewsPipeline,
  // Pass-through: трим уже сделан zod-схемой; поведение clean() покрыто core-тестами.
  clean: vi.fn((s: string) => s),
  ProfileManager: class {
    load = vi.fn(() => true);
    list = vi.fn(() => ['default']);
    create = vi.fn();
  },
}));

vi.mock('../../lib/server/llm', () => ({
  pickLlmClient: vi.fn(() => ({})),
}));

let POST: (req: NextRequest) => Promise<Response>;

beforeAll(async () => {
  ({ POST } = await import('../../app/api/blog/news/route'));
});

function req(body: unknown): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/blog/news', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function blog(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    slug: 'lookatfacts',
    name: 'Иди на факты глянь',
    profile: 'default',
    tg_chat_id: null,
    sources: null,
    style_preset: 'antonov',
    system_prompt: null,
    context_prompt: null,
    archived_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  mocks.getBlogBySlug.mockReset();
  mocks.recentPosts.mockReset().mockReturnValue([]);
  mocks.runNewsPipeline.mockReset().mockResolvedValue({
    news: { ranked: [] },
    post: null,
    factCheck: null,
    rssErrors: [],
  });
});

describe('POST /api/blog/news', () => {
  it('блог по умолчанию с sources=null уходит в дефолтные фиды, а не 400', async () => {
    mocks.getBlogBySlug.mockReturnValue(blog());

    const res = await POST(req({ hours: 24, top: 5, blog: 'lookatfacts' }));

    expect(res.status).toBe(200);
    expect(mocks.runNewsPipeline).toHaveBeenCalledTimes(1);
    expect(await res.text()).toContain('"type":"done"');
  });

  it('не-дефолтный блог без RSS-источников по-прежнему 400', async () => {
    mocks.getBlogBySlug.mockReturnValue(
      blog({ id: 2, slug: 'artemia-artel', name: 'Артемия Артель', profile: 'default' }),
    );

    const res = await POST(req({ blog: 'artemia-artel' }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining('не настроены RSS-источники'),
    });
    expect(mocks.runNewsPipeline).not.toHaveBeenCalled();
  });

  it('topic уходит в pipeline как focus (полный конвейер: тема разведки → news)', async () => {
    mocks.getBlogBySlug.mockReturnValue(blog());

    const res = await POST(req({ hours: 24, top: 5, blog: 'lookatfacts', topic: '  Трансфер Палмера  ' }));

    expect(res.status).toBe(200);
    expect(mocks.runNewsPipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ focus: 'Трансфер Палмера' }),
    );
  });
});
