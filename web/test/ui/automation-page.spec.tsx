// @vitest-environment jsdom
// UI-сценарий безопасности публикации (blog-блок, аудит 2026-11-17): «Запустить»
// на правиле с автопубликацией отправляет пост в реальный TG-канал — единственный
// publish-путь без подтверждения. Контракт после фикса: autoPublish → обязательный
// ConfirmDialog («реальная отправка»), без autoPublish → прогон сразу (черновик).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import AutomationPage from '../../app/automation/page';
import { ToastProvider } from '../../app/components/ui/Toast';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function json(data: unknown, ok = true): Response {
  return { ok, json: async () => data } as Response;
}

function rule(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    blogId: 1,
    blogSlug: 'lookatfacts',
    blogName: 'Иди на факты глянь',
    stylePreset: 'antonov',
    enabled: true,
    intervalMinutes: 360,
    autoPublish: false,
    nextRunAt: null,
    ...overrides,
  };
}

const RULES = {
  rules: [
    rule({ blogId: 1, blogName: 'Иди на факты глянь', autoPublish: true }),
    rule({ blogId: 2, blogName: 'Артемия Артель', autoPublish: false }),
  ],
  runs: [],
};

function stubFetch(): {
  fetchMock: ReturnType<typeof vi.fn>;
  bodies: unknown[];
} {
  const bodies: unknown[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url === '/api/automation' && method === 'GET') {
      return json(RULES);
    }
    if (url === '/api/automation' && method === 'POST') {
      bodies.push(JSON.parse(String(init?.body ?? '{}')));
      return json({ ok: true, status: 'success', message: 'пост создан (черновик)' });
    }
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, bodies };
}

describe('AutomationPage: подтверждение автопубликации', () => {
  it('autoPublish: «Запустить» открывает ConfirmDialog, POST только после подтверждения', async () => {
    const { bodies } = stubFetch();
    render(
      <ToastProvider>
        <AutomationPage />
      </ToastProvider>,
    );
    const user = userEvent.setup();

    const buttons = await screen.findAllByRole('button', { name: 'Запустить' });
    expect(buttons).toHaveLength(2);

    // Правило с автопубликацией: без подтверждения никакого POST.
    await user.click(buttons[0]);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('опубликует');
    expect(bodies).toEqual([]);

    // Подтверждение → прогон.
    await user.click(screen.getByRole('button', { name: 'Запустить прогон' }));
    await screen.findByText(/Прогон выполнен/);
    expect(bodies).toEqual([{ action: 'run', blogId: 1 }]);
  });

  it('без autoPublish: прогон стартует сразу, диалог не открывается', async () => {
    const { bodies } = stubFetch();
    render(
      <ToastProvider>
        <AutomationPage />
      </ToastProvider>,
    );
    const user = userEvent.setup();

    const buttons = await screen.findAllByRole('button', { name: 'Запустить' });
    await user.click(buttons[1]);

    await screen.findByText(/Прогон выполнен/);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(bodies).toEqual([{ action: 'run', blogId: 2 }]);
  });

  it('сбой загрузки правил виден, а не «молчаливая пустая страница»', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    render(<AutomationPage />);

    expect(await screen.findByText(/не удалось загрузить/)).toBeInTheDocument();
  });
});
