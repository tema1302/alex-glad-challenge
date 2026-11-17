// @vitest-environment jsdom
// UI-сценарий (S3 «Кнопки»): кнопки запуска прогонов honest-loading — spinner
// и блокировка на время стрима, «Стоп» остаётся активной (регресс-стоп).
// Гейт-мок: SSE-ответ — ReadableStream без чанков и без close; reader.read()
// не резолвится, running=true держится до конца теста.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import BlogNewsPage from '../../app/blog/news/page';
import BlogScoutPage from '../../app/blog/scout/page';
import { FullPipelineRun } from '../../app/blog/pipeline/FullPipelineRun';

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

/** Стрим открыт навсегда: ни одного чанка, нет close — прогон «висит». */
function openStream(): Response {
  const stream = new ReadableStream<Uint8Array>({
    start() {
      /* гейт: ничего не отдаём и не закрываем */
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const BLOGS = json({
  blogs: [
    { id: 1, slug: 'main', name: 'Главный', profile: 'default', hasProfile: true, sourcesCount: 1 },
  ],
});

describe('loading на кнопках запуска (гейт-мок держит стрим открытым)', () => {
  it('news: «Запустить» aria-busy + disabled, «Стоп» активна, лейбл не меняется', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === '/api/blogs' ? BLOGS : openStream(),
      ),
    );

    render(<BlogNewsPage />);
    const user = userEvent.setup();
    const run = screen.getByRole('button', { name: 'Запустить' });
    await user.click(run);

    await waitFor(() => expect(run).toHaveAttribute('aria-busy', 'true'));
    expect(run).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Стоп' })).toBeEnabled();
    // Индикатор-карточка стадий остаётся текстовым объяснением.
    expect(screen.getByText(/Pipeline работает…/)).toBeInTheDocument();
  });

  it('scout: «Запустить» aria-busy + disabled, «Стоп» активна', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === '/api/blogs' ? BLOGS : openStream(),
      ),
    );

    render(<BlogScoutPage />);
    const user = userEvent.setup();
    const run = screen.getByRole('button', { name: 'Запустить' });
    await user.click(run);

    await waitFor(() => expect(run).toHaveAttribute('aria-busy', 'true'));
    expect(run).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Стоп' })).toBeEnabled();
    expect(screen.getByText(/Scout работает…/)).toBeInTheDocument();
  });

  it('pipeline: «Запустить весь конвейер» aria-busy + disabled, «Стоп» активна', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => openStream()));

    render(<FullPipelineRun sandbox={false} />);
    const user = userEvent.setup();
    const run = screen.getByRole('button', { name: 'Запустить весь конвейер' });
    await user.click(run);

    await waitFor(() => expect(run).toHaveAttribute('aria-busy', 'true'));
    expect(run).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Стоп' })).toBeEnabled();
  });
});
