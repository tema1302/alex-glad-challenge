// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import BlogScoutPage from '../../app/blog/scout/page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BlogScoutPage: примеры запросов', () => {
  it('клик по примеру подставляет запрос в поле', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ blogs: [{ slug: 'main', name: 'Главный' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    render(<BlogScoutPage />);
    const user = userEvent.setup();

    const input = screen.getByRole('textbox', { name: 'Запрос' });
    await user.click(
      screen.getByRole('button', { name: 'Футбольные новости мужского футбола АПЛ и Челси' }),
    );
    expect(input).toHaveValue('Футбольные новости мужского футбола АПЛ и Челси');

    await user.click(screen.getByRole('button', { name: 'Продвинутая статистика по Челси' }));
    expect(input).toHaveValue('Продвинутая статистика по Челси');
  });

  it('показывает источники Mastodon/Lemmy/Sports.ru и не упоминает Reddit', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ blogs: [] }))));
    render(<BlogScoutPage />);

    expect(screen.getByText(/Mastodon \+ Lemmy \+ Sports\.ru/)).toBeInTheDocument();
    expect(screen.queryByText(/Reddit/i)).toBeNull();
  });

  it('Enter в «Запросе» запускает прогон (form submit, канон support-form.spec)', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/blogs') {
        return new Response(JSON.stringify({ blogs: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/blog/scout') {
        bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return new Response(
          [{ type: 'stage', step: 'start' }, { type: 'done', ranked: [], agents: [] }]
            .map((e) => `data: ${JSON.stringify(e)}\n\n`)
            .join(''),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        );
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<BlogScoutPage />);
    const user = userEvent.setup();
    const query = screen.getByRole('textbox', { name: 'Запрос' });
    await user.type(query, 'трансферы АПЛ');

    // Enter = submit формы (S4): без хендлеров на самом инпуте.
    fireEvent.submit(query.closest('form') as HTMLFormElement);

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ hours: 24, topK: 3, query: 'трансферы АПЛ', llm: 'cloud' });
  });
});
