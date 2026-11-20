// @vitest-environment jsdom
// UI-сценарий S5: дайджест уходит в канал ВЫБРАННОГО блога. Контракт: клиент
// шлёт только slug (chat_id резолвится на сервере из blogs.tg_chat_id),
// ConfirmDialog показывает реальную цель (имя блога, не глобальную маску),
// блог без своего канала — отправка пре-гейтится с честной причиной.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DigestComposer } from '../../app/blog/digest/DigestComposer';
import { ToastProvider } from '../../app/components/ui/Toast';

const DIGEST = 'Дайджест недели: три новости, одна сенсация.';

function json(data: unknown, ok = true): Response {
  return { ok, json: async () => data } as Response;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

interface StubResult {
  bodies: Array<Record<string, unknown>>;
}

function stub(blogs: unknown[]): StubResult {
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/blogs' && method === 'GET') return json({ blogs });
      if (url === '/api/blog/digest/generate') {
        return json({ ok: true, digest: DIGEST, newsCount: 1, sources: [], truncated: false });
      }
      if (url === '/api/telegram/publish' && method === 'POST') {
        bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return json({ ok: true, messageId: 9 });
      }
      return json({});
    }),
  );
  return { bodies };
}

const BLOGS = [
  {
    slug: 'lookatfacts',
    name: 'Иди на факты глянь',
    hasProfile: true,
    tgChatId: '-100111',
    tgChatIdSet: true,
  },
  {
    slug: 'tihiy',
    name: 'Тихий блог',
    hasProfile: true,
    tgChatId: null,
    tgChatIdSet: false,
  },
];

async function makeDigest(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Собрать дайджест' }));
  await screen.findByLabelText('Текст дайджеста');
}

describe('DigestComposer: канал выбранного блога', () => {
  it('confirm показывает канал блога; POST несёт slug, НЕ chat_id', async () => {
    const { bodies } = stub(BLOGS);
    render(
      <ToastProvider>
        <DigestComposer tgConfigured channelLabel="-100…9999" />
      </ToastProvider>,
    );
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText(/Блог/), 'lookatfacts');
    await makeDigest(user);

    await user.click(screen.getByRole('button', { name: 'Отправить в TG' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Иди на факты глянь');
    expect(dialog.textContent).not.toContain('-100…9999');

    await user.click(screen.getByRole('button', { name: 'Опубликовать' }));
    await screen.findByText(/Опубликовано/);
    expect(bodies[0]).toMatchObject({ text: DIGEST, parseMode: 'none', blog: 'lookatfacts' });
    expect(JSON.stringify(bodies[0])).not.toContain('-100111');
  });

  it('без блога — легаси-тело без поля blog (back-compat)', async () => {
    const { bodies } = stub(BLOGS);
    render(
      <ToastProvider>
        <DigestComposer tgConfigured channelLabel="-100…9999" />
      </ToastProvider>,
    );
    const user = userEvent.setup();
    await makeDigest(user);

    await user.click(screen.getByRole('button', { name: 'Отправить в TG' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('-100…9999'); // глобальный канал — честная цель
    await user.click(screen.getByRole('button', { name: 'Опубликовать' }));
    await screen.findByText(/Опубликовано/);
    expect(bodies[0]).toEqual({ text: DIGEST, parseMode: 'none' });
  });

  it('блог без своего канала: отправка пре-гейтится, причина видна', async () => {
    stub(BLOGS);
    render(
      <ToastProvider>
        <DigestComposer tgConfigured channelLabel="-100…9999" />
      </ToastProvider>,
    );
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText(/Блог/), 'tihiy');
    await makeDigest(user);

    expect(screen.getByRole('button', { name: 'Отправить в TG' })).toBeDisabled();
    expect(screen.getByText(/нет своего канала — задайте chat_id в студии/)).toBeInTheDocument();
  });
});
