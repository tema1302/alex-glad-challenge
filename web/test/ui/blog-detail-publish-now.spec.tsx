// @vitest-environment jsdom
// UI-сценарий (S3 «Кнопки»): галочка «сразу опубликовать» превращает «Создать
// пост» в подтверждаемое действие — реальная отправка в TG-канал. Контракт:
// publishNow on → ConfirmDialog (тема/канал/warn), до confirm — 0 POST;
// confirm → один POST с publishNow:true; cancel → без POST; publishNow off →
// без диалога, POST с publishNow falsy. Сбои Promise<boolean>: полный
// (!resp.ok) → диалог ОТКРЫТ, причина — тостом поверх оверлея, повтор не
// молчит; частичный (published.ok=false) → диалог закрыт (дубль опасен),
// честный тост, черновики видны.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Мок next/navigation — канон blog-post-publish.spec.tsx (usePathname для
// SPA-истории, useRouter для BackButton).
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
  sources: ['https://a.example/rss'],
  sourcesCount: 1,
  status: 'active',
  counts: { posts: 4, news: 6, styleSamples: 2, postsLast7Days: 3, lastPostAt: null },
  lastPostAt: null,
  agentPromptsCount: 0,
  readyForNews: true,
  createdAt: '2026-01-01T00:00:00Z',
};

/** Ответ POST /posts: по умолчанию успех; кейсы сбоя переопределяют. */
type PostResponder = (body: Record<string, unknown>) => Response;

/** Стабы всех четырёх mount-fetch'ов BlogDetail + сбор POST-тел создания поста. */
function stubFetch(
  postRespond: PostResponder = (body) =>
    json({
      posts: [{ id: 21, variant: 0, angle: 'праздничный' }],
      // Роут отдаёт published только при publishNow (route.ts:90) — стаб
      // зеркалит контракт, чтобы тост был честным («Черновики созданы»).
      published: body.publishNow ? { ok: true } : null,
    }),
): { postBodies: Array<Record<string, unknown>> } {
  const postBodies: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url === '/api/blogs/lookatfacts' && method === 'GET') return json({ blog: BLOG });
    if (url === '/api/blogs/lookatfacts/agent-prompts') return json({ prompts: [], customCount: 0 });
    if (url === '/api/blogs/lookatfacts/schedule') return json({ schedules: [], runs: [] });
    if (url === '/api/blog/posts?limit=5&blog=lookatfacts') return json({ posts: [] });
    if (url === '/api/blogs/lookatfacts/posts' && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      postBodies.push(body);
      return postRespond(body);
    }
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return { postBodies };
}

/** Монтирует BlogDetail, ждёт данных и открывает вкладку «Пост». */
async function mountPostTab(): Promise<ReturnType<typeof userEvent.setup>> {
  render(
    <ToastProvider>
      <BlogDetail slug="lookatfacts" />
    </ToastProvider>,
  );
  const user = userEvent.setup();
  await screen.findByRole('tablist', { name: 'Разделы блога' });
  await user.click(screen.getByRole('tab', { name: 'Пост' }));
  return user;
}

const TOPIC = 'Рождественская служба 7 января';

describe('BlogDetail, вкладка «Пост»: publishNow → подтверждение', () => {
  it('галочка on: диалог с темой и каналом; cancel — диалог закрыт, 0 POST', async () => {
    const { postBodies } = stubFetch();
    const user = await mountPostTab();

    await user.type(screen.getByLabelText(/Тема/), TOPIC);
    await user.click(screen.getByLabelText(/сразу опубликовать первый вариант/));
    await user.click(screen.getByRole('button', { name: 'Создать пост' }));

    // Диалог = интент: тема и канал видны до отправки, POST ещё не было.
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(TOPIC);
    expect(dialog.textContent).toContain('единственный вариант');
    expect(dialog.textContent).toContain('общий канал');
    expect(dialog.textContent).toContain('Реальная отправка');
    expect(postBodies).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(postBodies).toHaveLength(0);
  });

  it('confirm («Создать и опубликовать») → один POST с publishNow:true, диалог закрыт', async () => {
    const { postBodies } = stubFetch();
    const user = await mountPostTab();

    await user.type(screen.getByLabelText(/Тема/), TOPIC);
    await user.click(screen.getByLabelText(/сразу опубликовать первый вариант/));
    await user.click(screen.getByRole('button', { name: 'Создать пост' }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Создать и опубликовать' }));

    await screen.findByText(/Пост создан и опубликован/);
    expect(postBodies).toHaveLength(1);
    expect(postBodies[0]).toMatchObject({ topic: TOPIC, publishNow: true });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('галочка off: без диалога, POST уходит с publishNow falsy', async () => {
    const { postBodies } = stubFetch();
    const user = await mountPostTab();

    await user.type(screen.getByLabelText(/Тема/), TOPIC);
    await user.click(screen.getByRole('button', { name: 'Создать пост' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    await screen.findByText(/Черновики созданы/);
    expect(postBodies).toHaveLength(1);
    expect(postBodies[0]).toMatchObject({ topic: TOPIC });
    expect(postBodies[0].publishNow).toBeFalsy();
  });

  it('полный сбой (!resp.ok): диалог открыт, ровно 1 POST, причина — тостом', async () => {
    const { postBodies } = stubFetch(() => json({ error: 'LLM недоступна' }, 500));
    const user = await mountPostTab();

    await user.type(screen.getByLabelText(/Тема/), TOPIC);
    await user.click(screen.getByLabelText(/сразу опубликовать первый вариант/));
    await user.click(screen.getByRole('button', { name: 'Создать пост' }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Создать и опубликовать' }));

    // Причина видна поверх оверлея (postError за диалогом), диалог открыт —
    // решение о повторе за владельцем, черновиков не создано.
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('LLM недоступна');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(postBodies).toHaveLength(1);
    expect(screen.queryByText(/Черновики созданы/)).toBeNull();
    expect(screen.queryByText(/Пост создан и опубликован/)).toBeNull();
  });

  it('частичный сбой (published.ok=false): диалог закрыт, честный тост, черновики видны', async () => {
    const { postBodies } = stubFetch(
      () =>
        json({
          posts: [{ id: 21, variant: 0, angle: 'праздничный' }],
          published: { ok: false, error: 'TG недоступен' },
        }),
    );
    const user = await mountPostTab();

    await user.type(screen.getByLabelText(/Тема/), TOPIC);
    await user.click(screen.getByLabelText(/сразу опубликовать первый вариант/));
    await user.click(screen.getByRole('button', { name: 'Создать пост' }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Создать и опубликовать' }));

    // Черновики уже в БД — дубль опасен: диалог закрыт, тост честный.
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Пост создан, но публикация не удалась: TG недоступен');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(postBodies).toHaveLength(1);
    expect(screen.getByRole('link', { name: '#21' })).toBeInTheDocument();
  });
});
