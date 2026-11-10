// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import BlogHubPage, { slugify } from '../../app/blog/settings/page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const BLOGS = {
  profiles: ['default'],
  blogs: [
    {
      id: 1,
      slug: 'main',
      name: 'Главный',
      profile: 'default',
      hasProfile: true,
      tgChatId: null,
      tgChatIdSet: false,
      stylePreset: 'default',
      sources: ['https://a.example/rss'],
      sourcesCount: 1,
      status: 'active',
      archivedAt: null,
      createdAt: '2026-01-01T00:00:00Z',
      counts: { posts: 4, news: 6, styleSamples: 2, postsLast7Days: 3, lastPostAt: '2026-11-09T00:00:00Z' },
      lastPostAt: '2026-11-09T00:00:00Z',
      agentPromptsCount: 2,
      readyForNews: true,
    },
    {
      id: 2,
      slug: 'church',
      name: 'Храм',
      profile: null,
      hasProfile: false,
      tgChatId: null,
      tgChatIdSet: false,
      stylePreset: 'default',
      sources: [],
      sourcesCount: 0,
      status: 'active',
      archivedAt: null,
      createdAt: '2026-01-01T00:00:00Z',
      counts: { posts: 0, news: 0, styleSamples: 0, postsLast7Days: 0, lastPostAt: null },
      lastPostAt: null,
      agentPromptsCount: 0,
      readyForNews: false,
    },
  ],
};

function mockFetch(): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (url: string | URL) => {
    const href = String(url);
    if (href.includes('/api/blogs') && !href.includes('includeArchived=false')) {
      return new Response(JSON.stringify(BLOGS), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('slugify', () => {
  it('транслитерирует русское имя и убирает лишние дефисы', () => {
    expect(slugify('Невский храм на Доваторцев')).toBe('nevskiy-hram-na-dovatortsev');
    expect(slugify('  Привет, мир!  ')).toBe('privet-mir');
  });
});

describe('BlogHubPage', () => {
  it('показывает сводку и карточки с готовностью', async () => {
    mockFetch();
    render(<BlogHubPage />);

    expect(await screen.findByText('Главный · main')).toBeInTheDocument();
    expect(screen.getByText('Храм · church')).toBeInTheDocument();
    expect(screen.getByText('готов')).toBeInTheDocument();
    expect(screen.getByText('нужна настройка')).toBeInTheDocument();
    expect(screen.getByText('нет профиля')).toBeInTheDocument();
    expect(screen.getByText('промпты 2/7')).toBeInTheDocument();
  });

  it('создаёт блог через диалог и отправляет только заполненные поля', async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    render(<BlogHubPage />);
    await screen.findByText('Главный · main');

    await user.click(screen.getByRole('button', { name: 'Новый блог' }));
    await user.type(screen.getByLabelText('Название'), 'Новый храм');
    await waitFor(() => expect((screen.getByLabelText(/Slug/) as HTMLInputElement).value).toBe('novyy-hram'));
    await user.click(screen.getByRole('button', { name: 'Создать' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url) === '/api/blogs');
      expect(call).toBeTruthy();
      const body = JSON.parse(String((call![1] as RequestInit).body)) as Record<string, unknown>;
      expect(body).toMatchObject({ slug: 'novyy-hram', name: 'Новый храм', stylePreset: 'default' });
      expect(body).not.toHaveProperty('sources');
      expect(body).not.toHaveProperty('tgChatId');
    });
  });
});
