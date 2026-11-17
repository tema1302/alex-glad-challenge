// @vitest-environment jsdom
// UI-сценарий (S3 «Кнопки»): «Очистить» в компоузере дайджеста стирает черновик
// вместе с localStorage-копией — безвозвратно, поэтому за ConfirmDialog.
// Контракт: cancel — текст сохранён; confirm — форма возвращается в idle.
// Confirm-кнопка тоже называется «Очистить» — локаторы через within(dialog).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DigestComposer } from '../../app/blog/digest/DigestComposer';

afterEach(() => {
  cleanup();
  // Черновик автосохраняется в localStorage — между кейсами начинаем с чистого.
  localStorage.clear();
  vi.unstubAllGlobals();
});

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const DIGEST = 'Дайджест за неделю: три главные новости.';

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/blogs') return json({ blogs: [] });
      if (url === '/api/blog/digest/generate' && (init?.method ?? 'GET') === 'POST') {
        return json({
          ok: true,
          digest: DIGEST,
          newsCount: 3,
          sources: [{ title: 'Новость 1', url: 'https://a.example/n1' }],
          truncated: false,
        });
      }
      return json({});
    }),
  );
}

/** Монтирует компоузер и доводит его до preview-фазы с черновиком. */
async function mountWithDraft(): Promise<ReturnType<typeof userEvent.setup>> {
  stubFetch();
  render(<DigestComposer tgConfigured channelLabel="-100…1111" />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Собрать дайджест' }));
  const textarea = await screen.findByLabelText(/Текст дайджеста/);
  expect(textarea).toHaveValue(DIGEST);
  return user;
}

describe('DigestComposer: очистка черновика через подтверждение', () => {
  it('«Отмена» — текст и превью сохранены, диалог закрыт', async () => {
    const user = await mountWithDraft();

    await user.click(screen.getByRole('button', { name: 'Очистить' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('безвозвратно');

    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    const textarea = screen.getByLabelText(/Текст дайджеста/);
    expect(textarea).toHaveValue(DIGEST);
  });

  it('confirm («Очистить» внутри диалога) — форма возвращается в idle', async () => {
    const user = await mountWithDraft();

    await user.click(screen.getByRole('button', { name: 'Очистить' }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Очистить' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    // Preview-карточки нет — компоузер в idle, можно собирать заново.
    expect(screen.queryByLabelText(/Текст дайджеста/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Собрать дайджест' })).toBeEnabled();
  });
});
