// @vitest-environment jsdom
// UI-сценарий (S4 «Инпуты»): number-draft для числовых параметров прогонов.
// Контракт: state — строка (очистка не «отскакивает» в дефолт); ошибка видна
// сразу при невалидном вводе (aria-invalid из Field), кнопка запуска заблокирована
// и POST не уходит; пустое поле выпадает из body (дефолт сервера); валидный
// ввод уходит в POST как число. Границы — из zod (news 1–168/1–50, scout 1–10).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import BlogNewsPage from '../../app/blog/news/page';
import BlogScoutPage from '../../app/blog/scout/page';

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

function sse(events: unknown[]): Response {
  return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

const PROFILED_BLOG = { id: 1, slug: 'main', name: 'Главный', profile: 'default', hasProfile: true, sourcesCount: 1 };

/** Стаб news-прогона: /api/blogs + POST /api/blog/news (SSE done); тела пишутся в newsBodies. */
function stubNewsFetch(): { newsBodies: Array<Record<string, unknown>> } {
  const newsBodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/blogs') return json({ blogs: [PROFILED_BLOG] });
      if (url === '/api/blog/news') {
        newsBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return sse([
          { type: 'stage', step: 'start' },
          { type: 'done', post: null, topNews: [], verdict: null },
        ]);
      }
      return json({});
    }),
  );
  return { newsBodies };
}

describe('BlogNewsPage: number-draft поля прогона', () => {
  it('очистка не отскакивает: поле остаётся пустым (раньше Number(\'\')||24 возвращало 24)', async () => {
    stubNewsFetch();
    render(<BlogNewsPage />);
    const user = userEvent.setup();

    const hours = (await screen.findByLabelText('Часов')) as HTMLInputElement;
    expect(hours.value).toBe('24');
    await user.clear(hours);
    expect(hours.value).toBe('');
    // Пустое — валидно (не ошибка): hint «1–168» остаётся подсказкой,
    // текста ошибки и aria-invalid нет — ключ уйдёт из body, дефолт на сервере.
    expect(screen.queryByText(/ожидается целое число/)).toBeNull();
    expect(hours.getAttribute('aria-invalid')).toBeNull();
  });

  it('ввод «48» → POST /api/blog/news с hours:48', async () => {
    const { newsBodies } = stubNewsFetch();
    render(<BlogNewsPage />);
    const user = userEvent.setup();

    const hours = (await screen.findByLabelText('Часов')) as HTMLInputElement;
    await user.clear(hours);
    await user.type(hours, '48');
    await user.click(screen.getByRole('button', { name: 'Запустить' }));

    await waitFor(() => expect(newsBodies).toHaveLength(1));
    expect(newsBodies[0]).toMatchObject({ hours: 48, top: 5, forIndex: 0, llm: 'cloud' });
  });

  it('«200» → ошибка 1–168 сразу, aria-invalid, кнопка заблокирована, POST не уходит', async () => {
    const { newsBodies } = stubNewsFetch();
    render(<BlogNewsPage />);
    const user = userEvent.setup();

    const hours = (await screen.findByLabelText('Часов')) as HTMLInputElement;
    await user.clear(hours);
    await user.type(hours, '200');

    expect(screen.getByText(/1–168/)).toBeTruthy();
    expect(hours.getAttribute('aria-invalid')).toBe('true');
    const run = screen.getByRole('button', { name: 'Запустить' });
    expect(run).toBeDisabled();
    await user.click(run); // disabled: клик не запускает прогон
    expect(newsBodies).toHaveLength(0);
  });
});

describe('BlogScoutPage: number-draft дубль по topK', () => {
  it('«11» → ошибка 1–10 и блокировка запуска', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/blogs') return json({ blogs: [PROFILED_BLOG] });
        if (url === '/api/blog/scout') {
          bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
          return sse([{ type: 'stage', step: 'start' }, { type: 'done', ranked: [], agents: [] }]);
        }
        return json({});
      }),
    );
    render(<BlogScoutPage />);
    const user = userEvent.setup();

    const topK = (await screen.findByLabelText('Топ (topK)')) as HTMLInputElement;
    await user.clear(topK);
    await user.type(topK, '11');

    expect(screen.getByText(/1–10/)).toBeTruthy();
    expect(topK.getAttribute('aria-invalid')).toBe('true');
    const run = screen.getByRole('button', { name: 'Запустить' });
    expect(run).toBeDisabled();
    await user.click(run);
    expect(bodies).toHaveLength(0);
  });
});
