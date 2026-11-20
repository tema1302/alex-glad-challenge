// @vitest-environment jsdom
// UI-сценарий связности полного конвейера (blog-блок, аудит 2026-11-17):
// «Полный конвейер — один прогон» обещает связный прогон, но фаза news
// игнорировала результат scout. Контракт после фикса: топ-тема разведки
// передаётся в POST /api/blog/news как topic (fallback — сам запрос), и фаза 2
// честно показывает, про что пишет агент.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FullPipelineRun } from '../../app/blog/pipeline/FullPipelineRun';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear(); // S5: запоминание выбора блога (pipeline-blog) — не течёт между кейсами
});

function sse(events: unknown[]): Response {
  return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

const SCOUT_TOPIC = 'Трансфер Палмера в Челси подтверждён';

function scoutDone(ranked: unknown[]): Response {
  return sse([
    { type: 'stage', step: 'start' },
    {
      type: 'done',
      ranked,
      agents: [{ agent: 'forum', count: ranked.length, error: null }],
    },
  ]);
}

function newsDone(): Response {
  return sse([
    { type: 'stage', step: 'start' },
    {
      type: 'done',
      post: { id: 11, content: 'Готовый пост по теме.' },
      topNews: [],
      verdict: 'ok',
    },
  ]);
}

describe('FullPipelineRun: тема разведки → новостная фаза', () => {
  it('топ-тема scout уходит в /api/blog/news как topic и видна в фазе 2', async () => {
    const newsBodies: unknown[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/blog/scout') {
        return scoutDone([
          {
            title: SCOUT_TOPIC,
            source: 'forum',
            hypeScore: 9,
            hypeReason: 'горячо',
            orchestratorScore: 9,
            orchestratorReason: 'важно',
            url: null,
          },
        ]);
      }
      if (url === '/api/blog/news') {
        newsBodies.push(JSON.parse(String(init?.body ?? '{}')));
        return newsDone();
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<FullPipelineRun sandbox={false} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Запустить весь конвейер' }));

    await screen.findByText(/готово/);

    // Тема разведки передана в новостную фазу (раньше уходил только forIndex=0).
    expect(newsBodies).toHaveLength(1);
    expect(newsBodies[0]).toMatchObject({ topic: SCOUT_TOPIC });
    // Фаза 2 честно показывает, про что пишет агент.
    expect(screen.getByText(/пишем про/).textContent).toContain(SCOUT_TOPIC);
  });

  it('без тем scout topic = сам запрос владельца', async () => {
    const newsBodies: unknown[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/blog/scout') return scoutDone([]);
      if (url === '/api/blog/news') {
        newsBodies.push(JSON.parse(String(init?.body ?? '{}')));
        return newsDone();
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<FullPipelineRun sandbox={false} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Запрос для разведки/), 'самые горячие футбольные новости');
    await user.click(screen.getByRole('button', { name: 'Запустить весь конвейер' }));

    await screen.findByText(/готово/);

    expect(newsBodies).toHaveLength(1);
    expect(newsBodies[0]).toMatchObject({ topic: 'самые горячие футбольные новости' });
  });

  it('длинный запрос обрезается до лимита схемы topic (200), конвейер не падает 400', async () => {
    const newsBodies: unknown[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/blog/scout') return scoutDone([]);
      if (url === '/api/blog/news') {
        newsBodies.push(JSON.parse(String(init?.body ?? '{}')));
        return newsDone();
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const longQuery = 'ф'.repeat(250);
    render(<FullPipelineRun sandbox={false} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Запрос для разведки/), longQuery);
    await user.click(screen.getByRole('button', { name: 'Запустить весь конвейер' }));

    await screen.findByText(/готово/);

    expect(newsBodies).toHaveLength(1);
    const topic = (newsBodies[0] as { topic?: string }).topic;
    expect(topic).toHaveLength(200);
    expect(topic).toBe('ф'.repeat(200));
  });
});

// S5: конвейер по выбранному блогу — slug уходит в ОБА POST (scout и news);
// без выбора — легаси-тела без поля blog (снапшот-совместимость).
describe('FullPipelineRun: blog-контекст', () => {
  const BLOGS = {
    blogs: [
      {
        slug: 'artemia-artel',
        name: 'Артемия Артель',
        hasProfile: true,
        sourcesCount: 1,
        profile: 'artemia',
        readyForNews: true,
      },
    ],
  };

  function stubWithBlogs(scoutBodies: unknown[], newsBodies: unknown[]): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/blogs') return new Response(JSON.stringify(BLOGS), { status: 200 });
        if (url === '/api/blog/scout') {
          scoutBodies.push(JSON.parse(String(init?.body ?? '{}')));
          return scoutDone([]);
        }
        if (url === '/api/blog/news') {
          newsBodies.push(JSON.parse(String(init?.body ?? '{}')));
          return newsDone();
        }
        return new Response('{}', { status: 200 });
      }),
    );
  }

  it('выбранный блог уходит в тела scout и news', async () => {
    const scoutBodies: unknown[] = [];
    const newsBodies: unknown[] = [];
    stubWithBlogs(scoutBodies, newsBodies);
    render(<FullPipelineRun sandbox={false} />);
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText('блог'), 'artemia-artel');
    expect(screen.getByText(/по блогу «Артемия Артель»/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Запустить весь конвейер' }));
    await screen.findByText(/готово/);

    expect(scoutBodies[0]).toMatchObject({ blog: 'artemia-artel' });
    expect(newsBodies[0]).toMatchObject({ blog: 'artemia-artel' });
  });

  it('без блога — легаси: поля blog в телах нет', async () => {
    const scoutBodies: unknown[] = [];
    const newsBodies: unknown[] = [];
    stubWithBlogs(scoutBodies, newsBodies);
    render(<FullPipelineRun sandbox={false} />);
    const user = userEvent.setup();

    await screen.findByText(/без блога: стандартные источники и голос канала/);
    await user.click(screen.getByRole('button', { name: 'Запустить весь конвейер' }));
    await screen.findByText(/готово/);

    expect('blog' in (newsBodies[0] as Record<string, unknown>)).toBe(false);
    expect('blog' in (scoutBodies[0] as Record<string, unknown>)).toBe(false);
  });
});
