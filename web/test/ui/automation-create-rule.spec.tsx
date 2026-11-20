// @vitest-environment jsdom
// UI-сценарий S5: создание правила автоматизации из UI (upsert configure).
// Контракт: селектор только активных блогов без правила; интервал пресетами;
// автопубликация — warn без отдельного ConfirmDialog (правило ещё не публикует);
// «включить сразу» → enabled:true; ошибка загрузки блогов видна и повторяема,
// не сливаясь с ошибкой правил; POST — существующий {action:'configure'}.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
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

const BLOGS = {
  blogs: [
    {
      id: 1,
      slug: 'lookatfacts',
      name: 'Иди на факты глянь',
      hasProfile: true,
      sourcesCount: 2,
      tgChatId: '-100111',
      tgChatIdSet: true,
      readyForNews: true,
    },
    {
      id: 2,
      slug: 'artemia-artel',
      name: 'Артемия Артель',
      hasProfile: false,
      sourcesCount: 0,
      readyForNews: false,
    },
  ],
};

function rule(blogId: number, name: string): Record<string, unknown> {
  return {
    blogId,
    blogSlug: `b${blogId}`,
    blogName: name,
    stylePreset: 'default',
    enabled: true,
    intervalMinutes: 360,
    autoPublish: false,
    nextRunAt: null,
  };
}

function stub(opts: { rules?: Record<string, unknown>[]; blogsFail?: boolean } = {}): {
  bodies: unknown[];
} {
  const bodies: unknown[] = [];
  const rules = opts.rules ?? [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/automation' && method === 'GET') {
        return json({ rules, runs: [], schedulerEnabled: false });
      }
      if (url === '/api/automation' && method === 'POST') {
        bodies.push(JSON.parse(String(init?.body ?? '{}')));
        return json({ ok: true });
      }
      if (url === '/api/blogs' && method === 'GET') {
        if (opts.blogsFail) throw new Error('network down');
        return json(BLOGS);
      }
      return json({});
    }),
  );
  return { bodies };
}

function renderPage(): void {
  render(
    <ToastProvider>
      <AutomationPage />
    </ToastProvider>,
  );
}

describe('AutomationPage: создание правила из UI', () => {
  it('выбор блога + интервал → POST configure; 5 мин показывает warn', async () => {
    const { bodies } = stub();
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Создать правило' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('блог'), '1');
    await user.selectOptions(within(dialog).getByLabelText('интервал прогона'), '5');
    expect(screen.getByText(/пост в канал каждые 5 минут/)).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText('интервал прогона'), '60');

    await user.click(within(dialog).getByRole('button', { name: 'Создать правило' }));
    await screen.findByText(/Правило для «Иди на факты глянь» создано/);
    expect(bodies).toEqual([
      { action: 'configure', blogId: 1, enabled: false, autoPublish: false, intervalMinutes: 60 },
    ]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('автопубликация — warn без диалога; «включить сразу» → enabled:true', async () => {
    const { bodies } = stub();
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Создать правило' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('блог'), '2'); // блог без chat_id
    await user.click(within(dialog).getByLabelText(/автопубликация/));
    expect(screen.getByText(/пост уйдёт в общий канал/)).toBeInTheDocument();
    expect(screen.getByText(/он же включает публикацию слотов расписания/)).toBeInTheDocument();
    await user.click(within(dialog).getByLabelText(/включить сразу/));

    await user.click(within(dialog).getByRole('button', { name: 'Создать правило' }));
    await screen.findByText(/Правило для «Артемия Артель» создано/);
    expect(screen.queryByRole('dialog')).toBeNull(); // отдельного confirm нет
    expect(bodies).toEqual([
      { action: 'configure', blogId: 2, enabled: true, autoPublish: true, intervalMinutes: 360 },
    ]);
  });

  it('сбой /api/blogs виден отдельно от правил и повторяем', async () => {
    stub({ rules: [rule(7, 'Тихий блог')], blogsFail: true });
    renderPage();
    const user = userEvent.setup();

    expect(await screen.findByText(/Тихий блог/)).toBeInTheDocument(); // правила живы
    await user.click(screen.getByRole('button', { name: 'Создать правило' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Не удалось загрузить блоги/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'повторить' })).toBeInTheDocument();
  });

  it('schedulerEnabled:false — честная строка «планировщик выключен»', async () => {
    stub();
    renderPage();
    expect(
      await screen.findByText(/планировщик: выключен — правила не срабатывают автоматически/),
    ).toBeInTheDocument();
  });
});
