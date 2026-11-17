// @vitest-environment jsdom
// UI-сценарий селекторов блогов (blog-блок, аудит 2026-11-17): сбой загрузки
// /api/blogs ловился молча (.catch(() => setBlogs([]))) и выдавал «блогов нет»
// при активной кнопке, а disabled «Собрать дайджест» не объяснял причину.
// Контракт после фикса: ошибка загрузки видна с retry; пустой список — честная
// пометка о легаси-режиме; причина disabled — рядом с кнопкой.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import BlogNewsPage from '../../app/blog/news/page';
import { DigestComposer } from '../../app/blog/digest/DigestComposer';

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

function blogsResponse(blogs: unknown[]): Response {
  return json({ blogs });
}

const PROFILED_BLOG = { id: 1, slug: 'lookatfacts', name: 'Иди на факты глянь', profile: 'default', hasProfile: true, sourcesCount: 2 };
const PROFILELESS_BLOG = { id: 2, slug: 'no-profile', name: 'Без голоса', profile: null, hasProfile: false, sourcesCount: 2 };

describe('BlogNewsPage: состояние списка блогов', () => {
  it('сбой /api/blogs виден с retry, после retry список подгружается', async () => {
    let fail = true;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/blogs') {
        if (fail) {
          fail = false;
          throw new Error('network down');
        }
        return blogsResponse([PROFILED_BLOG]);
      }
      return json({});
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<BlogNewsPage />);
    const user = userEvent.setup();

    expect(await screen.findByText(/Не удалось загрузить блоги/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'обновить блоги' }));

    await waitFor(() => {
      expect(screen.queryByText(/Не удалось загрузить блоги/)).toBeNull();
    });
    const select = screen.getByLabelText(/Блог/) as HTMLSelectElement;
    expect(select.options.length).toBeGreaterThan(0);
  });

  it('пустой список блогов — честная пометка про легаси-режим', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === '/api/blogs' ? blogsResponse([]) : json({}),
      ),
    );

    render(<BlogNewsPage />);

    expect(await screen.findByText(/легаси-режиме/)).toBeInTheDocument();
  });
});

describe('DigestComposer: состояние списка блогов и причина disabled', () => {
  it('сбой /api/blogs виден, а не «молчаливый пустой селект»', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    render(<DigestComposer tgConfigured channelLabel="-100…1111" />);

    expect(await screen.findByText(/Не удалось загрузить блоги/)).toBeInTheDocument();
  });

  it('disabled «Собрать дайджест» объясняет причину рядом с кнопкой', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === '/api/blogs' ? blogsResponse([PROFILELESS_BLOG]) : json({}),
      ),
    );

    render(<DigestComposer tgConfigured channelLabel="-100…1111" />);
    const user = userEvent.setup();

    const select = (await screen.findByLabelText(/Блог/)) as HTMLSelectElement;
    await user.selectOptions(select, 'no-profile');

    const button = screen.getByRole('button', { name: 'Собрать дайджест' });
    expect(button).toBeDisabled();
    expect(screen.getByText(/профиль голоса не настроен/)).toBeInTheDocument();
  });
});
