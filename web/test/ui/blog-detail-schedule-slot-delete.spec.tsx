// @vitest-environment jsdom
// UI-сценарий (S3 «Кнопки»): удаление слота расписания — danger-кнопка из
// общего словаря (не красный текст-линк) и без ConfirmDialog: слот — локальный
// dirty-черновик до «Сохранить расписание», бейдж несохранённых изменений
// честно показывает состояние.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Мок next/navigation — канон blog-post-publish.spec.tsx.
vi.mock('next/navigation', () => ({
  usePathname: () => '/blog/settings/lookatfacts',
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

import { BlogDetail } from '../../app/blog/settings/[slug]/BlogDetail';
import { ToastProvider } from '../../app/components/ui/Toast';

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

const BLOG = {
  id: 1,
  slug: 'lookatfacts',
  name: 'Иди на факты глянь',
  profile: 'default',
  hasProfile: true,
  tgChatId: null,
  stylePreset: 'default',
  systemPrompt: null,
  contextPrompt: null,
  sources: [],
  sourcesCount: 0,
  status: 'active',
  counts: { posts: 0, news: 0, styleSamples: 0, postsLast7Days: 0, lastPostAt: null },
  lastPostAt: null,
  agentPromptsCount: 0,
  readyForNews: false,
  createdAt: '2026-01-01T00:00:00Z',
};

const SCHEDULE = [
  { dayOfWeek: 6, timeLocal: '10:00', timezone: 'Europe/Moscow', topic: 'субботний сбор', variants: 1, enabled: true },
  { dayOfWeek: 0, timeLocal: '18:00', timezone: 'Europe/Moscow', topic: '', variants: 1, enabled: true },
];

describe('BlogDetail, вкладка «Расписание»: удаление слота', () => {
  it('«Удалить слот»: danger-словарь + min-h-32; клик убирает слот и зажигает dirty-бейдж', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (url === '/api/blogs/lookatfacts' && method === 'GET') return json({ blog: BLOG });
        if (url === '/api/blogs/lookatfacts/agent-prompts') return json({ prompts: [], customCount: 0 });
        if (url === '/api/blogs/lookatfacts/schedule') return json({ schedules: SCHEDULE, runs: [] });
        if (url === '/api/blog/posts?limit=5&blog=lookatfacts') return json({ posts: [] });
        return json({});
      }),
    );

    render(
      <ToastProvider>
        <BlogDetail slug="lookatfacts" />
      </ToastProvider>,
    );
    const user = userEvent.setup();
    await screen.findByRole('tablist', { name: 'Разделы блога' });
    await user.click(screen.getByRole('tab', { name: 'Расписание' }));

    // Оба слота на месте; кнопка — из danger-словаря кита.
    const buttons = screen.getAllByRole('button', { name: 'Удалить слот' });
    expect(buttons).toHaveLength(2);
    expect(buttons[0].className).toContain('border-err/60');
    expect(buttons[0].className).toContain('text-err');
    expect(buttons[0].className).toContain('min-h-[32px]');
    expect(screen.getByDisplayValue('субботний сбор')).toBeInTheDocument();

    await user.click(buttons[0]);

    // Слот исчез, подтверждения не было, изменения видны бейджем.
    expect(screen.getAllByRole('button', { name: 'Удалить слот' })).toHaveLength(1);
    expect(screen.queryByDisplayValue('субботний сбор')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('есть несохранённые изменения')).toBeInTheDocument();
  });
});
