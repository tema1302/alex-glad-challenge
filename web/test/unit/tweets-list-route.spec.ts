// Unit: GET /api/blog/tweets (ранжирование) + /api/blog/tweets/authors (активность).
// Границы замоканы: db, chokepoint. Проверяем sort/limit/author, 400 на window<=0.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getBlogBySlug: vi.fn(),
  listTweets: vi.fn(),
  authorActivity: vi.fn(),
}));

vi.mock('../../lib/server/db', () => ({
  getBlogDb: vi.fn(() => ({
    getBlogBySlug: mocks.getBlogBySlug,
    listTweets: mocks.listTweets,
  })),
  withDb: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../../lib/server/challenge', () => ({
  DEFAULT_BLOG_SLUG: 'lookatfacts',
  dataPath: vi.fn((p: string) => p),
  ProfileManager: class {
    load = vi.fn(() => true);
    list = vi.fn(() => ['default']);
    create = vi.fn();
  },
  windowSinceIso: vi.fn(() => '2026-01-01T00:00:00Z'),
  popularityScore: (t: { likes: number }) => t.likes,
  discussionScore: (t: { replies: number }) => t.replies,
  authorActivity: mocks.authorActivity,
  parseTweetUrl: () => null,
}));

let GET: (req: NextRequest) => Promise<Response>;
let GETAuthors: (req: NextRequest) => Promise<Response>;
beforeAll(async () => {
  ({ GET } = await import('../../app/api/blog/tweets/route'));
  ({ GET: GETAuthors } = await import('../../app/api/blog/tweets/authors/route'));
});

function req(query: string): NextRequest {
  return new NextRequest(`http://127.0.0.1:3000/api/blog/tweets${query}`);
}

const BLOG = { id: 1, slug: 'lookatfacts', name: 'Иди на факты глянь', archived_at: null };
function row(id: number, handle: string, likes: number, replies: number) {
  return {
    id, tweet_id: String(id), author_handle: handle, text: `t${id}`, url: `https://x.com/${handle}/status/${id}`,
    published_at: '2026-11-16T00:00:00Z', likes, retweets: 0, replies, quotes: 0, views: 0, bookmarks: 0,
    media: '[]', fetched_at: '2026-11-17T00:00:00Z', blog_id: 1,
  };
}

beforeEach(() => {
  mocks.getBlogBySlug.mockReset().mockReturnValue(BLOG);
  mocks.listTweets.mockReset().mockReturnValue([row(1, 'a', 10, 1), row(2, 'b', 500, 5), row(3, 'c', 999, 2)]);
  mocks.authorActivity.mockReset().mockReturnValue([{ handle: 'markrstats', count: 3, popularity: 1509 }]);
});

describe('GET /api/blog/tweets', () => {
  it('sort=popularity → убыв. по популярности', async () => {
    const res = await GET(req('?window=30&sort=popularity'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(3);
    expect(body.tweets.map((t: { authorHandle: string }) => t.authorHandle)).toEqual(['c', 'b', 'a']);
    expect(body.tweets[0].popularity).toBe(999);
  });

  it('sort=discussion → по ответам', async () => {
    const res = await GET(req('?sort=discussion'));
    const body = await res.json();
    expect(body.tweets[0].authorHandle).toBe('b'); // replies 5
  });

  it('limit и author пробрасываются в listTweets', async () => {
    const res = await GET(req('?limit=1&author=markrstats'));
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(mocks.listTweets).toHaveBeenCalledWith(expect.objectContaining({ author: 'markrstats' }));
  });

  it('window<=0 → 400', async () => {
    const res = await GET(req('?window=0'));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/blog/tweets/authors', () => {
  it('возвращает активность авторов за окно', async () => {
    const res = await GETAuthors(new NextRequest('http://127.0.0.1:3000/api/blog/tweets/authors?window=7'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.authors[0].handle).toBe('markrstats');
    expect(mocks.authorActivity).toHaveBeenCalledTimes(1);
  });
});