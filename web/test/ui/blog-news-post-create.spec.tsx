// @vitest-environment jsdom
// UI-сценарий: новость из топ-списка кликабельна → POST from-item → ссылка
// «открыть и править» ведёт в редактор поста.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import BlogNewsPage from '../../app/blog/news/page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function sse(events: unknown[]): Response {
  return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('BlogNewsPage: клик по новости создаёт пост', () => {
  it('кликабельный топ-новости → from-item → ссылка в редактор', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/blogs')) {
        return json({
          blogs: [
            { id: 1, slug: 'main', name: 'Главный', profile: 'default', hasProfile: true, sourcesCount: 1 },
          ],
        });
      }
      if (url.includes('/api/blog/news/from-item')) {
        return json({ ok: true, post: { id: 9, content: 'Пост по новости' }, verdict: 'ok' });
      }
      if (url.includes('/api/blog/news')) {
        return sse([
          { type: 'stage', step: 'start' },
          {
            type: 'done',
            post: null,
            topNews: [{ id: 5, title: 'Челси обыграл АПЛ-лидера', score: 9, why: 'важно' }],
            verdict: null,
          },
        ]);
      }
      return json({});
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<BlogNewsPage />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Запустить' }));

    const newsButton = await screen.findByRole('button', {
      name: /Создать пост по новости: Челси обыграл АПЛ-лидера/,
    });
    expect(screen.getByText(/Нажмите на новость/)).toBeInTheDocument();
    await user.click(newsButton);

    const editLink = await screen.findByRole('link', { name: 'открыть и править →' });
    expect(editLink).toHaveAttribute('href', '/blog/posts/9');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/blog/news/from-item',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
