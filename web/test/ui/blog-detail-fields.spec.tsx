// @vitest-environment jsdom
// UI-сценарий (S4 «Инпуты») карточки блога:
//   1) tgChatId — pattern + blur-валидация («@username» → NaN в publishPost)
//      с блокировкой «Сохранить настройки»;
//   2) таймзоны слотов — datalist-подсказки + blur-валидация Intl (кривая зона
//      тихо убивала слот в core) с блокировкой «Сохранить расписание»;
//   3) formError — role="alert" (ошибка сохранения озвучивается скринридером).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Мок next/navigation — канон blog-detail-publish-now.spec.tsx.
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

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
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
  { dayOfWeek: 6, timeLocal: '10:00', timezone: 'Europe/Moscow', topic: '', variants: 1, enabled: true },
];

/** Стабы четырёх mount-fetch'ов (канон publish-now) + PATCH-роут по желанию. */
function stubFetch(patchStatus?: { status: number; error: string }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/blogs/lookatfacts' && method === 'GET') return json({ blog: BLOG });
      if (url === '/api/blogs/lookatfacts' && method === 'PATCH') {
        if (patchStatus) return json({ error: patchStatus.error }, patchStatus.status);
        return json({ blog: BLOG });
      }
      if (url === '/api/blogs/lookatfacts/agent-prompts') return json({ prompts: [], customCount: 0 });
      if (url === '/api/blogs/lookatfacts/schedule') return json({ schedules: SCHEDULE, runs: [] });
      if (url === '/api/blog/posts?limit=5&blog=lookatfacts') return json({ posts: [] });
      return json({});
    }),
  );
}

/** Монтирует карточку, ждёт данных и открывает вкладку. */
async function mountTab(tab: 'Настройки' | 'Расписание'): Promise<ReturnType<typeof userEvent.setup>> {
  render(
    <ToastProvider>
      <BlogDetail slug="lookatfacts" />
    </ToastProvider>,
  );
  const user = userEvent.setup();
  await screen.findByRole('tablist', { name: 'Разделы блога' });
  await user.click(screen.getByRole('tab', { name: tab }));
  return user;
}

describe('BlogDetail, вкладка «Настройки»: tgChatId — числовой id', () => {
  it('input несёт pattern и подсказку формата', async () => {
    stubFetch();
    await mountTab('Настройки');

    const tg = screen.getByLabelText(/Telegram chat_id/) as HTMLInputElement;
    expect(tg.getAttribute('pattern')).toBe('-?\\d+');
    expect(screen.getByText(/числовой id канала, например -1001234567890/)).toBeTruthy();
  });

  it('«@username» после blur — ошибка и блок «Сохранить настройки»; -100… снова активна', async () => {
    stubFetch();
    const user = await mountTab('Настройки');

    const tg = screen.getByLabelText(/Telegram chat_id/) as HTMLInputElement;
    await user.type(tg, '@chelsea');
    await user.tab(); // blur — ошибка появляется после ухода из поля

    expect(screen.getByText(/ожидается числовой id канала/)).toBeTruthy();
    expect(tg.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('button', { name: 'Сохранить настройки' })).toBeDisabled();

    await user.clear(tg);
    await user.type(tg, '-1001234567890');
    expect(screen.queryByText(/ожидается числовой id канала/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Сохранить настройки' })).toBeEnabled();
  });
});

describe('BlogDetail, вкладка «Расписание»: таймзона слота', () => {
  it('инпут зоны связан с datalist подсказок, hint рядом', async () => {
    stubFetch();
    await mountTab('Расписание');

    const tz = screen.getByLabelText('таймзона') as HTMLInputElement;
    expect(tz.getAttribute('list')).toBe('tz-suggestions');
    expect(screen.getByText(/например, Europe\/Moscow/)).toBeTruthy();

    const dl = document.getElementById('tz-suggestions') as HTMLDataListElement;
    expect(dl.tagName).toBe('DATALIST');
    const options = Array.from(dl.options).map((o) => o.value);
    expect(options).toContain('Europe/Moscow');
    expect(options).toContain('Asia/Irkutsk');
    expect(options.length).toBeGreaterThanOrEqual(14);
  });

  it('кривая зона после blur — ошибка и блок «Сохранить расписание»', async () => {
    stubFetch();
    const user = await mountTab('Расписание');

    const tz = screen.getByLabelText('таймзона') as HTMLInputElement;
    await user.clear(tz);
    await user.type(tz, 'Mars/Olympus');
    await user.tab();

    expect(screen.getByText(/неизвестная таймзона/)).toBeTruthy();
    expect(tz.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('button', { name: 'Сохранить расписание' })).toBeDisabled();
  });
});

describe('BlogDetail: ошибки форм озвучиваются (role="alert")', () => {
  it('PATCH 400 → formError с role="alert"', async () => {
    stubFetch({ status: 400, error: 'имя уже занято' });
    const user = await mountTab('Настройки');

    // Делаем форму грязной и сохраняем — PATCH отвечает 400.
    await user.type(screen.getByLabelText('Название'), '!');
    await user.click(screen.getByRole('button', { name: 'Сохранить настройки' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('имя уже занято');
    // formError — единственный alert: тост не участвует в этом сценарии.
    expect(within(document.body).queryAllByRole('alert')).toHaveLength(1);
  });
});
