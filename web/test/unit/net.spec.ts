// Unit: netFetch — стратегия «прокси-first → direct-фолбэк», таймауты, abort,
// человекочитаемые ошибки. fetch глобальный — стабим vi.stubGlobal.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { netFetch } from '@challenge/core/net.js';

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response> | never) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.HTTPS_PROXY;
  delete process.env.https_proxy;
});

describe('netFetch', () => {
  it('прокси задан и работает → одна попытка через dispatcher, фолбэк не нужен', async () => {
    process.env.HTTPS_PROXY = 'http://127.0.0.1:10808';
    const fetchMock = mockFetch((_url, init) => {
      expect((init as Record<string, unknown>)['dispatcher']).toBeDefined();
      return Promise.resolve(new Response('ok'));
    });

    const resp = await netFetch('https://example.test/x', { label: 'цель' });
    expect(resp.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('прокси лежит → фолбэк на прямое подключение (кейс «fetch failed» из пайплайнов)', async () => {
    process.env.HTTPS_PROXY = 'http://127.0.0.1:9';
    let call = 0;
    const dispatchers: unknown[] = [];
    const fetchMock = mockFetch((_url, init) => {
      call++;
      dispatchers.push((init as Record<string, unknown>)['dispatcher']);
      if (call === 1) throw new TypeError('fetch failed'); // мёртвый прокси
      expect((init as Record<string, unknown>)['dispatcher']).toBeUndefined(); // direct
      return Promise.resolve(new Response('ok-direct'));
    });

    const resp = await netFetch('https://example.test/x', { label: 'LLM-провайдер' });
    expect(await resp.text()).toBe('ok-direct');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(dispatchers[0]).toBeDefined();
  });

  it('обе попытки исчерпаны → человекочитаемая ошибка с label, без сырого «fetch failed»', async () => {
    process.env.HTTPS_PROXY = 'http://127.0.0.1:9';
    mockFetch(() => {
      throw new TypeError('fetch failed');
    });

    await expect(netFetch('https://example.test/x', { label: 'RSS championat.com' })).rejects.toThrow(
      /RSS championat\.com: сеть недоступна.*HTTPS_PROXY/s,
    );
  });

  it('HTTP-ошибка (5xx) не ретраится — ответ возвращается как есть', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(new Response('boom', { status: 502 })));
    const resp = await netFetch('https://example.test/x');
    expect(resp.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('клиентский abort не ретраится', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = mockFetch((_url, init) => {
      // Имитируем поведение fetch: abort до старта → немедленный reject.
      if ((init as RequestInit).signal?.aborted) {
        return Promise.reject(new DOMException('This operation was aborted', 'AbortError'));
      }
      return Promise.resolve(new Response('ok'));
    });

    await expect(
      netFetch('https://example.test/x', { signal: controller.signal, label: 'цель' }),
    ).rejects.toThrow('aborted');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('без прокси — только прямое подключение', async () => {
    const fetchMock = mockFetch((_url, init) => {
      expect((init as Record<string, unknown>)['dispatcher']).toBeUndefined();
      return Promise.resolve(new Response('ok'));
    });
    await netFetch('https://example.test/x');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
