// Unit: readHubAttention — внимание хаба /blog (S1): черновики без публикации
// (recentPosts × outbox.latestForPost, семантика = /api/blog/posts) + последняя
// отправка TG (outbox.recent(1), как /api/telegram/history). Канон моков —
// blogs-route.spec.ts: vi.mock lib/server/db (withDb passthrough) +
// lib/server/challenge; outbox — по фактическому API (lib/server/outbox).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  recentPosts: vi.fn(),
  latestForPost: vi.fn(),
  recent: vi.fn(),
}));

vi.mock('../../lib/server/db', () => ({
  getBlogDb: vi.fn(() => ({
    recentPosts: mocks.recentPosts,
  })),
  withDb: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../../lib/server/outbox', () => ({
  getOutboxDb: vi.fn(() => ({
    latestForPost: mocks.latestForPost,
    recent: mocks.recent,
  })),
}));

vi.mock('../../lib/server/challenge', () => ({
  DEFAULT_BLOG_SLUG: 'main',
  ProfileManager: class {},
  dataPath: vi.fn((p: string) => p),
}));

interface HubAttentionResult {
  draftsCount: number;
  lastSend: {
    status: 'ok' | 'error';
    error: string | null;
    createdAt: string;
    postId: number | null;
  } | null;
}

let readHubAttention: () => Promise<HubAttentionResult>;

beforeAll(async () => {
  ({ readHubAttention } = await import('../../lib/server/blogs'));
});

beforeEach(() => {
  mocks.recentPosts.mockReset();
  mocks.latestForPost.mockReset();
  mocks.recent.mockReset();
});

describe('readHubAttention', () => {
  it('черновики: посты без записи outbox; опубликованные не считаются', async () => {
    mocks.recentPosts.mockReturnValue([{ id: 1 }, { id: 2 }, { id: 3 }]);
    mocks.latestForPost.mockImplementation((id: number) => (id === 2 ? { id: 9, blog_post_id: 2 } : null));
    mocks.recent.mockReturnValue([]);

    const data = await readHubAttention();
    expect(data.draftsCount).toBe(2);
    expect(data.lastSend).toBeNull();
  });

  it('lastSend: outbox.recent(1) → safe-поля, без text/source/message_id', async () => {
    mocks.recentPosts.mockReturnValue([]);
    mocks.recent.mockReturnValue([
      {
        id: 7,
        text: 'текст отправленного поста',
        source: 'blog',
        blog_post_id: 42,
        message_id: 111,
        status: 'error',
        error: 'chat not found',
        created_at: '2026-11-17T12:00:00Z',
      },
    ]);

    const data = await readHubAttention();
    expect(data.draftsCount).toBe(0);
    expect(data.lastSend).toEqual({
      status: 'error',
      error: 'chat not found',
      createdAt: '2026-11-17T12:00:00Z',
      postId: 42,
    });
  });

  it('пустые БД: нулевое внимание без исключений', async () => {
    mocks.recentPosts.mockReturnValue([]);
    mocks.recent.mockReturnValue([]);

    const data = await readHubAttention();
    expect(data).toEqual({ draftsCount: 0, lastSend: null });
  });
});
