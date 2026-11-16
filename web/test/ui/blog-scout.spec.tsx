// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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
});
