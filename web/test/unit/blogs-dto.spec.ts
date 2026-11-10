// Unit: единый DTO-маппер блога и архивный guard.
// Раньше PATCH отдавал raw BlogRow (snake_case) — этот тест фиксирует camelCase.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/server/db', () => ({
  getBlogDb: vi.fn(),
  withDb: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../../lib/server/challenge', () => ({
  ProfileManager: class {},
  dataPath: vi.fn((p: string) => p),
  DEFAULT_BLOG_SLUG: 'lookatfacts',
}));

import { blogArchivedError, toBlogDto } from '../../lib/server/blogs';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    slug: 'main',
    name: 'Главный',
    profile: 'default',
    tg_chat_id: '-1001',
    sources: JSON.stringify(['https://a.example/rss']),
    style_preset: 'antonov',
    system_prompt: 'пиши тепло',
    context_prompt: 'аудитория — прихожане',
    archived_at: null,
    created_at: '2026-01-01 00:00:00',
    ...overrides,
  } as never;
}

describe('toBlogDto', () => {
  it('отдаёт camelCase, sources-массив, counts и статус', () => {
    const dto = toBlogDto(row(), {
      hasProfile: true,
      stats: { posts: 3, news: 4, styleSamples: 1, postsLast7Days: 2, lastPostAt: '2026-11-09' },
      agentPromptsCount: 2,
    });
    expect(dto).toMatchObject({
      slug: 'main',
      hasProfile: true,
      tgChatId: '-1001',
      tgChatIdSet: true,
      stylePreset: 'antonov',
      systemPrompt: 'пиши тепло',
      contextPrompt: 'аудитория — прихожане',
      sources: ['https://a.example/rss'],
      sourcesCount: 1,
      status: 'active',
      agentPromptsCount: 2,
      readyForNews: true,
      counts: { posts: 3, postsLast7Days: 2 },
      lastPostAt: '2026-11-09',
    });
    expect(dto).not.toHaveProperty('style_preset');
    expect(dto).not.toHaveProperty('created_at');
  });

  it('sources=null → пустой массив, status=archived', () => {
    const dto = toBlogDto(row({ sources: null, archived_at: '2026-11-01T00:00:00Z' }), {
      hasProfile: false,
    });
    expect(dto.sources).toEqual([]);
    expect(dto.sourcesCount).toBe(0);
    expect(dto.status).toBe('archived');
    expect(dto.archivedAt).toBe('2026-11-01T00:00:00Z');
    expect(dto.readyForNews).toBe(false);
  });
});

describe('blogArchivedError', () => {
  it('null для активного, понятный текст для архивного', () => {
    expect(blogArchivedError(row())).toBeNull();
    expect(blogArchivedError(row({ archived_at: '2026-11-01T00:00:00Z' }))).toContain('в архиве');
  });
});
