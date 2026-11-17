// @vitest-environment jsdom
// UI-сценарий publish-целостности (blog-блок, аудит 2026-11-17): ConfirmDialog
// показывает отредактированный черновик, а POST /publish публикует СОХРАНЁННУЮ
// версию — пользователь подтверждает не то, что уйдёт подписчикам канала.
// Контракт после фикса: при dirty «Опубликовать» сначала сохраняет черновик
// (PATCH до POST /publish), превью диалога = то, что реально уходит в канал.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '7' }),
  useRouter: () => ({ push }),
}));

import BlogPostDetailPage from '../../app/blog/posts/[id]/page';
import { ToastProvider } from '../../app/components/ui/Toast';

afterEach(() => {
  cleanup();
  push.mockClear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const SAVED = 'Сохранённая версия поста';
const EDITED = 'Правка владельца: Челси — 3:0, гол Палмера на 90+3';

describe('BlogPostDetailPage: publish-целостность (dirty → save → publish)', () => {
  it('подтверждение при несохранённых правках: PATCH до POST /publish, в диалоге — отредактированный текст', async () => {
    let savedContent = SAVED;
    const calls: string[] = [];
    let publishAfterPatch = false;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/settings') {
        return json({ botChannelLabel: '-100…1111' });
      }
      if (url === '/api/blog/posts/7' && method === 'GET') {
        return json({
          post: { id: 7, news_id: null, content: savedContent, verdict: null, created_at: '2026-11-17T10:00:00.000Z' },
          blog: { id: 1, slug: 'main', name: 'Главный', tgChatId: '-100…0345' },
          tg: null,
        });
      }
      if (url === '/api/blog/posts/7' && method === 'PATCH') {
        calls.push(`PATCH:${savedContent}`);
        const body = JSON.parse(String(init?.body ?? '{}')) as { content?: string };
        savedContent = body.content ?? savedContent;
        publishAfterPatch = calls.some((c) => c.startsWith('PUBLISH'));
        return json({
          post: { id: 7, news_id: null, content: savedContent, verdict: null, created_at: '2026-11-17T10:00:00.000Z' },
        });
      }
      if (url === '/api/blog/posts/7/publish' && method === 'POST') {
        calls.push('PUBLISH');
        return json({ ok: true, messageId: 4242 });
      }
      return json({});
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ToastProvider>
        <BlogPostDetailPage />
      </ToastProvider>,
    );
    const user = userEvent.setup();

    // Ждём загрузки сохранённой версии.
    const textarea = await screen.findByLabelText(/Текст поста/);
    expect(textarea).toHaveValue(SAVED);

    // Владелец правит черновик и не нажимает «Сохранить».
    await user.clear(textarea);
    await user.type(textarea, EDITED);

    // Диалог показывает именно отредактированный текст + честную пометку.
    await user.click(screen.getByRole('button', { name: 'Опубликовать в Telegram' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(EDITED);
    expect(dialog.textContent).toContain('сохран');

    // Подтверждение: черновик сохраняется ДО публикации, без PUBLISH до PATCH.
    await user.click(screen.getByRole('button', { name: 'Опубликовать', hidden: false }));
    await screen.findByText(/Опубликовано в Telegram/);
    expect(publishAfterPatch).toBe(false);
    expect(calls).toEqual([`PATCH:${SAVED}`, 'PUBLISH']);
  });

  it('чистый черновик: подтверждение публикует без лишнего PATCH', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/settings') return json({ botChannelLabel: null });
      if (url === '/api/blog/posts/7' && method === 'GET') {
        return json({
          post: { id: 7, news_id: null, content: 'Чистый черновик', verdict: null, created_at: '2026-11-17T10:00:00.000Z' },
          blog: null,
          tg: null,
        });
      }
      if (url === '/api/blog/posts/7' && method === 'PATCH') {
        calls.push('PATCH');
        return json({ post: { id: 7, news_id: null, content: 'Чистый черновик', verdict: null, created_at: '2026-11-17T10:00:00.000Z' } });
      }
      if (url === '/api/blog/posts/7/publish' && method === 'POST') {
        calls.push('PUBLISH');
        return json({ ok: true, messageId: 11 });
      }
      return json({});
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ToastProvider>
        <BlogPostDetailPage />
      </ToastProvider>,
    );
    const user = userEvent.setup();
    await screen.findByLabelText(/Текст поста/);

    await user.click(screen.getByRole('button', { name: 'Опубликовать в Telegram' }));
    await user.click(await screen.findByRole('button', { name: 'Опубликовать', hidden: false }));
    await screen.findByText(/Опубликовано в Telegram/);

    expect(calls).toEqual(['PUBLISH']);
  });

  it('сетевой сбой ≠ «Пост не найден»: ошибка видна, retry восстанавливает страницу', async () => {
    let fail = true;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/settings') return json({ botChannelLabel: null });
      if (url === '/api/blog/posts/7' && method === 'GET') {
        if (fail) {
          fail = false;
          throw new Error('network down');
        }
        return json({
          post: { id: 7, news_id: null, content: 'Пост загрузился после retry', verdict: null, created_at: '2026-11-17T10:00:00.000Z' },
          blog: null,
          tg: null,
        });
      }
      return json({});
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ToastProvider>
        <BlogPostDetailPage />
      </ToastProvider>,
    );
    const user = userEvent.setup();

    // Сбой загрузки — ошибка, а не маска под 404.
    expect(await screen.findByText('network down')).toBeInTheDocument();
    expect(screen.queryByText(/Пост не найден/)).toBeNull();

    // Retry поднимает страницу.
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    const textarea = await screen.findByLabelText(/Текст поста/);
    expect(textarea).toHaveValue('Пост загрузился после retry');
  });
});
