// @vitest-environment jsdom
// UI-сценарий селекторов блогов (blog-блок, аудит 2026-11-17): сбой загрузки
// /api/blogs ловился молча (.catch(() => setBlogs([]))) и выдавал «блогов нет»
// при активной кнопке, а disabled «Собрать дайджест» не объяснял причину.
// Контракт после фикса: ошибка загрузки видна с retry; пустой список — честная
// пометка без инженерного жаргона; причина disabled — рядом с кнопкой.
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

  it('пустой список блогов — честная пометка без легаси-жаргона', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === '/api/blogs' ? blogsResponse([]) : json({}),
      ),
    );

    render(<BlogNewsPage />);

    expect(
      await screen.findByText(/Настроенных блогов нет — прогон пойдёт без выбранного блога/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/легаси/)).toBeNull();
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

describe('Пустой выбор «— без блога —» — явная опция (S4)', () => {
  // Digest-черновик автосохраняется в localStorage — между кейсами чисто.
  afterEach(() => {
    localStorage.clear();
  });

  it('news: пустой option первый, hint «пусто — стандартные источники и голос канала»', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === '/api/blogs' ? blogsResponse([PROFILED_BLOG]) : json({}),
      ),
    );

    render(<BlogNewsPage />);

    const select = (await screen.findByLabelText(/Блог/)) as HTMLSelectElement;
    expect(select.options[0].value).toBe('');
    expect(select.options[0].textContent).toBe('— без блога —');
    expect(select.value).toBe('');
    expect(screen.getByText(/пусто — стандартные источники и голос канала/)).toBeInTheDocument();
  });

  it('DigestComposer: selectOptions(\'\') → POST /api/blog/digest/generate БЕЗ ключа blog', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/blogs') return blogsResponse([PROFILED_BLOG]);
        if (url === '/api/blog/digest/generate') {
          bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
          return json({ ok: true, digest: 'Дайджест недели.', newsCount: 2, sources: [], truncated: false });
        }
        return json({});
      }),
    );

    render(<DigestComposer tgConfigured channelLabel="-100…1111" />);
    const user = userEvent.setup();

    const select = (await screen.findByLabelText(/Блог/)) as HTMLSelectElement;
    expect(select.options[0].value).toBe('');
    expect(select.options[0].textContent).toBe('— без блога —');
    expect(screen.getByText(/пусто — все новости в голосе канала по умолчанию/)).toBeInTheDocument();

    await user.selectOptions(select, '');
    await user.click(screen.getByRole('button', { name: 'Собрать дайджест' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ days: 7 });
    expect(Object.hasOwn(bodies[0], 'blog')).toBe(false);
  });
});
