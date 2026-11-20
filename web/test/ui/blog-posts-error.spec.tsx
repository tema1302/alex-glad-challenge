// @vitest-environment jsdom
// S6 «сбой ≠ пусто»: список постов при сетевом сбое показывает error-карточку с
// «Повторить», а не EmptyState «Постов пока нет». Контракт со S2-снапшотом
// (арбитраж S6): при непустом списке неудачный refresh данные НЕ прячет и
// снапшот НЕ чистит (last-known-good + тост) — снапшот пишется только на успех.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import BlogPostsPage from '../../app/blog/posts/page';
import { ToastProvider } from '../../app/components/ui/Toast';
import { readListSnapshot, __testReset } from '../../lib/shared/spaHistory';

vi.mock('next/navigation', () => ({
  usePathname: () => '/blog/posts',
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));

beforeEach(() => {
  sessionStorage.clear();
  __testReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const POST = {
  id: 7,
  news_id: null,
  content: 'Свежий пост про Челси',
  verdict: null,
  created_at: '2026-11-01T10:00:00.000Z',
  blog: { id: 1, slug: 'main', name: 'Главный' },
  tg: null,
};

function json(data: unknown, ok = true): Response {
  return { ok, json: async () => data } as Response;
}

interface StubControl {
  failPosts: boolean;
  postsCalls: number;
}

function stub(): StubControl {
  const ctl: StubControl = { failPosts: true, postsCalls: 0 };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/blogs') return json({ blogs: [] });
      if (url.startsWith('/api/blog/posts?')) {
        ctl.postsCalls += 1;
        if (ctl.failPosts) throw new Error('network down');
        return json({ posts: [POST] });
      }
      return json({});
    }),
  );
  return ctl;
}

describe('BlogPostsPage: сбой загрузки ≠ пустой список', () => {
  it('сбой → ошибка + «Повторить», EmptyState не показан', async () => {
    stub();
    render(
      <ToastProvider>
        <BlogPostsPage />
      </ToastProvider>,
    );

    expect(await screen.findByText('ошибка загрузки')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
    expect(screen.queryByText('Постов пока нет')).toBeNull();
  });

  it('«Повторить» после сбоя загружает данные', async () => {
    const ctl = stub();
    render(
      <ToastProvider>
        <BlogPostsPage />
      </ToastProvider>,
    );
    const user = userEvent.setup();

    await screen.findByRole('button', { name: 'Повторить' });
    ctl.failPosts = false;
    await user.click(screen.getByRole('button', { name: 'Повторить' }));

    // Пост виден (desktop-таблица + mobile-карточки — оба в DOM: getAllBy).
    expect((await screen.findAllByText(/Свежий пост про Челси/)).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /Свежий пост про Челси/ })[0]).toHaveAttribute(
      'href',
      '/blog/posts/7',
    );
    expect(screen.queryByText('ошибка загрузки')).toBeNull();
  });

  it('неудачный refresh непустого списка: данные остаются, снапшот не чистится', async () => {
    const ctl = stub();
    ctl.failPosts = false;
    render(
      <ToastProvider>
        <BlogPostsPage />
      </ToastProvider>,
    );
    const user = userEvent.setup();

    await screen.findAllByText(/Свежий пост про Челси/);
    expect(readListSnapshot('/blog/posts')).not.toBeNull();

    // Refresh падает: список на экране остаётся (last-known-good), error-карточки нет.
    ctl.failPosts = true;
    await user.click(screen.getByRole('button', { name: 'обновить' }));
    await screen.findByText(/network down/); // тост/строка ошибки

    expect(screen.getAllByText(/Свежий пост про Челси/).length).toBeGreaterThan(0);
    expect(screen.queryByText('ошибка загрузки')).toBeNull();
    expect(screen.queryByText('Постов пока нет')).toBeNull();
    // Арбитраж S6: снапшот при сбое не чистим — возврат «← назад» покажет валидные данные.
    expect(readListSnapshot('/blog/posts')).not.toBeNull();
  });
});
