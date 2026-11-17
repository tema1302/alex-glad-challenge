// Unit: POST /api/blog/tweets/ingest — ингест твита (url → fxtwitter / manual).
// Границы замоканы: db, chokepoint. Проверяем 201/400, выбор url vs manual, архив.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getBlogBySlug: vi.fn(),
  ingestTweet: vi.fn(),
  ingestManualTweet: vi.fn(),
}));

vi.mock('../../lib/server/db', () => ({
  getBlogDb: vi.fn(() => ({ getBlogBySlug: mocks.getBlogBySlug })),
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
  ingestTweet: mocks.ingestTweet,
  ingestManualTweet: mocks.ingestManualTweet,
  popularityScore: (t: { likes: number }) => t.likes,
  discussionScore: (t: { replies: number }) => t.replies,
  parseTweetUrl: () => null,
}));

let POST: (req: NextRequest) => Promise<Response>;
beforeAll(async () => {
  ({ POST } = await import('../../app/api/blog/tweets/ingest/route'));
});

function req(body: unknown): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/blog/tweets/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const BLOG = { id: 1, slug: 'lookatfacts', name: 'Иди на факты глянь', archived_at: null };
const TWEET = {
  id: 1, tweet_id: '2122351771880456203', author_handle: 'markrstats', text: 'Chelsea xG 1.56 → 1.00',
  url: 'https://x.com/markrstats/status/2122351771880456203', published_at: '2026-11-16T15:31:08Z',
  likes: 318, retweets: 52, replies: 3, quotes: 25, views: 51015, bookmarks: 43,
  media: '[]', fetched_at: '2026-11-17T00:00:00Z', blog_id: 1,
};

beforeEach(() => {
  mocks.getBlogBySlug.mockReset().mockReturnValue(BLOG);
  mocks.ingestTweet.mockReset().mockResolvedValue({ isNew: true, tweet: TWEET });
  mocks.ingestManualTweet.mockReset().mockReturnValue({ isNew: true, tweet: TWEET });
});

describe('POST /api/blog/tweets/ingest', () => {
  it('manual (author+text) → 201 + DTO, ingestManualTweet с blogId', async () => {
    const res = await POST(req({ author: 'markrstats', text: 'Chelsea xG', likes: 318 }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.tweet.authorHandle).toBe('markrstats');
    expect(body.tweet.popularity).toBe(318);
    expect(mocks.ingestManualTweet).toHaveBeenCalledTimes(1);
    expect(mocks.ingestTweet).not.toHaveBeenCalled();
    expect(mocks.ingestManualTweet.mock.calls[0][2]).toBe(1);
  });

  it('url → ingestTweet (fxtwitter), не manual', async () => {
    const res = await POST(req({ url: 'https://x.com/markrstats/status/2122351771880456203' }));
    expect(res.status).toBe(201);
    expect(mocks.ingestTweet).toHaveBeenCalledTimes(1);
    expect(mocks.ingestManualTweet).not.toHaveBeenCalled();
  });

  it('пустое тело → 400 (нужен url или author+text)', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(mocks.ingestTweet).not.toHaveBeenCalled();
    expect(mocks.ingestManualTweet).not.toHaveBeenCalled();
  });

  it('архивный блог → 400', async () => {
    mocks.getBlogBySlug.mockReturnValue({ ...BLOG, archived_at: '2026-11-10T00:00:00Z' });
    const res = await POST(req({ author: 'markrstats', text: 'x' }));
    expect(res.status).toBe(400);
    expect(mocks.ingestManualTweet).not.toHaveBeenCalled();
  });

  it('ошибка ингеста (не ссылка) → 400', async () => {
    mocks.ingestTweet.mockRejectedValue(new Error('Не ссылка на твит и не ID'));
    const res = await POST(req({ url: 'мусор' }));
    expect(res.status).toBe(400);
  });
});