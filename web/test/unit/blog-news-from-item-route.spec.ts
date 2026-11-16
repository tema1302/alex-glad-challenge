// Unit: POST /api/blog/news/from-item — пост по выбранной новости из топ-списка.
// Границы замоканы: db, chokepoint pipeline, llm. Проверяем 200/400/404/502,
// наследование блога по news.blog_id и защиту от чужого блога.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getBlogBySlug: vi.fn(),
  getBlog: vi.fn(),
  getNews: vi.fn(),
  runPostFromNews: vi.fn(),
}));

vi.mock('../../lib/server/db', () => ({
  getBlogDb: vi.fn(() => ({
    getBlogBySlug: mocks.getBlogBySlug,
    getBlog: mocks.getBlog,
    getNews: mocks.getNews,
  })),
  withDb: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../../lib/server/challenge', () => ({
  DEFAULT_BLOG_SLUG: 'lookatfacts',
  dataPath: vi.fn((p: string) => p),
  runPostFromNews: mocks.runPostFromNews,
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
  ({ POST } = await import('../../app/api/blog/news/from-item/route'));
});

function req(body: unknown): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/blog/news/from-item', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const BLOG = {
  id: 1,
  slug: 'lookatfacts',
  name: 'Иди на факты глянь',
  profile: 'default',
  tg_chat_id: null,
  sources: null,
  style_preset: 'default',
  system_prompt: null,
  context_prompt: null,
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
};

const NEWS = {
  id: 5,
  url: 'https://example.com/news',
  title: 'Новость',
  summary: 'Кратко',
  published_at: '2026-11-16T00:00:00Z',
  source: 'test',
  used: 0,
  created_at: '2026-11-16T00:00:00Z',
  blog_id: 1,
};

beforeEach(() => {
  mocks.getBlogBySlug.mockReset().mockReturnValue(BLOG);
  mocks.getBlog.mockReset().mockReturnValue(BLOG);
  mocks.getNews.mockReset().mockReturnValue(NEWS);
  mocks.runPostFromNews.mockReset().mockResolvedValue({
    postId: 99,
    post: { content: 'Готовый пост', news: { id: 5 } },
    factCheck: { verdict: 'ok', issues: [], recommendation: '', reasoning: '' },
  });
});

describe('POST /api/blog/news/from-item', () => {
  it('создаёт пост по newsId и возвращает id/verdict', async () => {
    const res = await POST(req({ newsId: 5, blog: 'lookatfacts' }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      post: { id: 99, content: 'Готовый пост' },
      verdict: 'ok',
    });
    expect(mocks.runPostFromNews).toHaveBeenCalledTimes(1);
    expect(mocks.runPostFromNews).toHaveBeenCalledWith(
      expect.anything(),
      {},
      expect.objectContaining({ newsId: 5, blog: BLOG }),
    );
  });

  it('без blog наследует блог новости по blog_id', async () => {
    const res = await POST(req({ newsId: 5 }));
    expect(res.status).toBe(200);
    expect(mocks.runPostFromNews).toHaveBeenCalledWith(
      expect.anything(),
      {},
      expect.objectContaining({ newsId: 5, blog: BLOG }),
    );
  });

  it('неизвестная новость → 404', async () => {
    mocks.getNews.mockReturnValue(null);
    const res = await POST(req({ newsId: 404 }));
    expect(res.status).toBe(404);
    expect(mocks.runPostFromNews).not.toHaveBeenCalled();
  });

  it('новость другого блога → 400', async () => {
    mocks.getNews.mockReturnValue({ ...NEWS, blog_id: 2 });
    const res = await POST(req({ newsId: 5, blog: 'lookatfacts' }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'Новость принадлежит другому блогу',
    });
    expect(mocks.runPostFromNews).not.toHaveBeenCalled();
  });

  it('архивный блог → 400', async () => {
    mocks.getBlogBySlug.mockReturnValue({ ...BLOG, archived_at: '2026-11-10T00:00:00Z' });
    const res = await POST(req({ newsId: 5, blog: 'lookatfacts' }));
    expect(res.status).toBe(400);
    expect(mocks.runPostFromNews).not.toHaveBeenCalled();
  });

  it('ошибка генерации → 502 без стека', async () => {
    mocks.runPostFromNews.mockRejectedValue(new Error('LLM unavailable'));
    const res = await POST(req({ newsId: 5, blog: 'lookatfacts' }));
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: 'LLM unavailable' });
  });
});
