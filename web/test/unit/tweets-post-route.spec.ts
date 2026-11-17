// Unit: POST /api/blog/tweets/post — пост Антонова из сохранённого твита.
// Границы замоканы: db, chokepoint, llm. Проверяем 200/400/404/502, архив, профиль.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getBlogBySlug: vi.fn(),
  getTweet: vi.fn(),
  getTweetByTweetId: vi.fn(),
  writePostFromTweet: vi.fn(),
}));

vi.mock('../../lib/server/db', () => ({
  getBlogDb: vi.fn(() => ({
    getBlogBySlug: mocks.getBlogBySlug,
    getTweet: mocks.getTweet,
    getTweetByTweetId: mocks.getTweetByTweetId,
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
  writePostFromTweet: mocks.writePostFromTweet,
  parseTweetUrl: () => null,
  popularityScore: (t: { likes: number }) => t.likes,
  discussionScore: (t: { replies: number }) => t.replies,
}));

vi.mock('../../lib/server/llm', () => ({
  pickLlmClient: vi.fn(() => ({})),
}));

let POST: (req: NextRequest) => Promise<Response>;
beforeAll(async () => {
  ({ POST } = await import('../../app/api/blog/tweets/post/route'));
});

function req(body: unknown): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/blog/tweets/post', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const BLOG = { id: 1, slug: 'lookatfacts', name: 'Иди на факты глянь', profile: 'default', archived_at: null };
const TWEET = {
  id: 1, tweet_id: '2122351771880456203', author_handle: 'markrstats', text: 'Chelsea xG',
  url: 'https://x.com/markrstats/status/2122351771880456203', published_at: '2026-11-16T15:31:08Z',
  likes: 318, retweets: 52, replies: 3, quotes: 25, views: 51015, bookmarks: 43,
  media: '[]', fetched_at: '2026-11-17T00:00:00Z', blog_id: 1,
};

beforeEach(() => {
  mocks.getBlogBySlug.mockReset().mockReturnValue(BLOG);
  mocks.getTweet.mockReset().mockReturnValue(TWEET);
  mocks.getTweetByTweetId.mockReset().mockReturnValue(TWEET);
  mocks.writePostFromTweet.mockReset().mockResolvedValue({
    postId: 99,
    post: { content: 'Иди на факты глянь: пост про xG.' },
    factCheck: { verdict: 'ok', issues: [], recommendation: '', reasoning: '' },
  });
});

describe('POST /api/blog/tweets/post', () => {
  it('создаёт пост из твита по DB id → 200 + verdict', async () => {
    const res = await POST(req({ tweet: '1', blog: 'lookatfacts' }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      post: { id: 99, content: 'Иди на факты глянь: пост про xG.' },
      verdict: 'ok',
    });
    expect(mocks.writePostFromTweet).toHaveBeenCalledWith(
      expect.anything(),
      {},
      TWEET,
      expect.objectContaining({ blog: BLOG }),
    );
  });

  it('твит не найден → 404', async () => {
    mocks.getTweet.mockReturnValue(null);
    const res = await POST(req({ tweet: '404' }));
    expect(res.status).toBe(404);
    expect(mocks.writePostFromTweet).not.toHaveBeenCalled();
  });

  it('архивный блог → 400', async () => {
    mocks.getBlogBySlug.mockReturnValue({ ...BLOG, archived_at: '2026-11-10T00:00:00Z' });
    const res = await POST(req({ tweet: '1' }));
    expect(res.status).toBe(400);
    expect(mocks.writePostFromTweet).not.toHaveBeenCalled();
  });

  it('без tweet → 400', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it('ошибка генерации → 502 без стека', async () => {
    mocks.writePostFromTweet.mockRejectedValue(new Error('LLM unavailable'));
    const res = await POST(req({ tweet: '1' }));
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: 'LLM unavailable' });
  });
});