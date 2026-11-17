// @vitest-environment jsdom
// UI: BlogHubView (хаб /blog, S1) — вид на чистых props, 0 моков и 0 fetch:
// это контракт тестируемости из консилиума (презентационный вид, вся логика —
// на сервере). Маркер пульса — data-testid="blog-pulse" (канон blog-pulse.spec).
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { BlogHubView } from '../../app/blog/BlogHubView';

const PULSE = {
  generatedAt: '2026-11-18T00:00:00Z',
  totals: {
    blogs: 1,
    active: 1,
    needsAttention: 1,
    posts: 3,
    postsLast7Days: 2,
    customPrompts: 1,
  },
  blogs: [
    {
      id: 1,
      slug: 'main',
      name: 'Главный',
      hasProfile: false,
      sourcesCount: 0,
      readyForNews: false,
      counts: { posts: 3, news: 5, styleSamples: 0, postsLast7Days: 2, lastPostAt: null },
      lastPostAt: null,
      agentPromptsCount: 1,
    },
  ],
};

const ATTENTION = {
  draftsCount: 2,
  lastSend: {
    status: 'error' as const,
    error: 'chat not found',
    createdAt: '2026-11-17T12:00:00Z',
    postId: 7,
  },
};

const EMPTY_ATTENTION = { draftsCount: 0, lastSend: null };

// 6 входов по задачам: [accessible name, href] — порядок = порядок плиток в виде.
const ENTRY_TILES: ReadonlyArray<readonly [string, string]> = [
  ['Новости → пост', '/blog/news'],
  ['Черновики и посты', '/blog/posts'],
  ['Дайджест', '/blog/digest'],
  ['Полный конвейер', '/blog/pipeline'],
  ['Поиск тем', '/blog/scout'],
  ['Студия блогов', '/blog/settings'],
];

afterEach(cleanup);

describe('BlogHubView', () => {
  it('шесть входов по задачам со своими href (news — primary)', () => {
    render(<BlogHubView pulse={PULSE} attention={ATTENTION} />);

    expect(screen.getByRole('heading', { name: 'Ваши блоги' })).toBeInTheDocument();
    for (const [name, href] of ENTRY_TILES) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
    }
    // primary-плитка одна: «Новости → пост».
    expect(screen.getByRole('link', { name: 'Новости → пост' }).className).toContain('bg-accent');
  });

  it('пульс встроен целиком (testid + карточки блогов из props)', () => {
    render(<BlogHubView pulse={PULSE} attention={ATTENTION} />);

    expect(screen.getByTestId('blog-pulse')).toBeInTheDocument();
    expect(screen.getByText('Главный')).toBeInTheDocument();
    expect(screen.getByText('нужна настройка')).toBeInTheDocument();
  });

  it('блок внимания: черновики → посты, блог без настройки → карточка, ошибка TG → пост', () => {
    render(<BlogHubView pulse={PULSE} attention={ATTENTION} />);

    const draftsRow = screen.getByText(/Черновики без публикации/);
    expect(draftsRow.textContent).toContain('2');
    expect(screen.getByRole('link', { name: 'открыть посты →' })).toHaveAttribute(
      'href',
      '/blog/posts',
    );
    expect(screen.getByText(/Блог «Главный» — нужна настройка/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'настроить →' })).toHaveAttribute(
      'href',
      '/blog/settings/main',
    );
    expect(screen.getByText('Последняя отправка в Telegram:')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'к посту →' })).toHaveAttribute(
      'href',
      '/blog/posts/7',
    );
  });

  it('ошибка TG без поста (manual/summary-отправка) → «к постам» — список, а не карточка', () => {
    render(
      <BlogHubView
        pulse={PULSE}
        attention={{
          draftsCount: 0,
          lastSend: { status: 'error', error: 'timeout', createdAt: '2026-11-17T12:00:00Z', postId: null },
        }}
      />,
    );

    expect(screen.getByRole('link', { name: 'к постам →' })).toHaveAttribute('href', '/blog/posts');
    expect(screen.queryByRole('link', { name: 'к посту →' })).toBeNull();
  });

  it('пустое состояние: 0 блогов → CTA «Создать блог», входы и спокойное внимание остаются', () => {
    render(
      <BlogHubView
        pulse={{
          ...PULSE,
          totals: { active: 0, needsAttention: 0, postsLast7Days: 0, customPrompts: 0 },
          blogs: [],
        }}
        attention={EMPTY_ATTENTION}
      />,
    );

    expect(screen.getByText('Блогов пока нет')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Создать блог' })).toHaveAttribute(
      'href',
      '/blog/settings',
    );
    expect(screen.getByText('Всё спокойно: ничего не требует внимания.')).toBeInTheDocument();

    // Секции-входы не исчезают на пустом состоянии.
    for (const [name, href] of ENTRY_TILES) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
    }
  });
});
