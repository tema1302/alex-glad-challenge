// @vitest-environment jsdom
// S6: переименование rag-чата — Dialog + Field вместо window.prompt.
// Контракт: пустой ввод блокирует «Сохранить» (без хака 'untitled'), отмена ничего
// не шлёт, сбой PATCH виден в диалоге (role=alert), успех чистит снапшот списка.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import RagChatPage from '../../app/rag/chat/[dialogChatId]/page';

vi.mock('next/navigation', () => ({
  useParams: () => ({ dialogChatId: 'abc' }),
  usePathname: () => '/rag/chat/abc',
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

function json(data: unknown, ok = true): Response {
  return { ok, json: async () => data } as Response;
}

interface StubResult {
  patchBodies: Array<Record<string, unknown>>;
}

function stub(opts: { patchFails?: boolean } = {}): StubResult {
  const patchBodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/rag/chat/abc' && method === 'GET') {
        return json({ chat: { title: 'Старый заголовок' }, messages: [], taskStateText: '' });
      }
      if (url === '/api/rag/chat/abc' && method === 'PATCH') {
        patchBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        if (opts.patchFails) return json({ error: 'не удалось сохранить' }, false);
        return json({ chat: { title: 'Новый заголовок' } });
      }
      return json({});
    }),
  );
  return { patchBodies };
}

describe('RagChatPage: переименование через Dialog', () => {
  it('диалог с текущим названием; «Сохранить» → PATCH {title}', async () => {
    const { patchBodies } = stub();
    render(<RagChatPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'переименовать' }));
    const dialog = await screen.findByRole('dialog');
    const input = screen.getByLabelText('Название') as HTMLInputElement;
    expect(input.value).toBe('Старый заголовок');

    await user.clear(input);
    await user.type(input, 'Новый заголовок');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(patchBodies).toEqual([{ title: 'Новый заголовок' }]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Новый заголовок')).toBeInTheDocument();
    expect(dialog).not.toBeNull();
  });

  it('«Отмена» — PATCH не зван, заголовок прежний', async () => {
    const { patchBodies } = stub();
    render(<RagChatPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'переименовать' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }));

    expect(patchBodies).toEqual([]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Старый заголовок')).toBeInTheDocument();
  });

  it('пустой ввод: «Сохранить» disabled (без молчаливого untitled)', async () => {
    stub();
    render(<RagChatPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'переименовать' }));
    await screen.findByRole('dialog');
    await user.clear(screen.getByLabelText('Название'));
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  });

  it('сбой PATCH: ошибка в диалоге, заголовок не изменился', async () => {
    const { patchBodies } = stub({ patchFails: true });
    render(<RagChatPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'переименовать' }));
    await screen.findByRole('dialog');
    await user.clear(screen.getByLabelText('Название'));
    await user.type(screen.getByLabelText('Название'), 'Новый заголовок');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(patchBodies).toEqual([{ title: 'Новый заголовок' }]);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument(); // остаётся открыт
    expect(screen.getByText('Старый заголовок')).toBeInTheDocument();
  });
});
