// Unit: Route Handler POST /api/blog/digest/generate — второй auth-слой (requireAuth),
// zod-схема (days 1..30, дефолт 7), пустое окно → 409 без LLM, grounded-промпт
// (clean() над title/summary, URL только из выборки), clamp ≤4096 + truncated,
// LLM-ошибка → 502 safeMessage, cloud-first с фолбэком local. db/llm/env мокаются;
// challenge-chokepoint подменяется реальными чистыми модулями core (sanitize/types);
// auth — реальный (HMAC-cookie на тестовых env).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';

vi.mock('../../lib/server/db', () => ({
  getBlogDb: vi.fn(),
  withDb: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../../lib/server/llm', () => ({
  pickLlmClient: vi.fn(),
}));

vi.mock('../../lib/server/env', () => ({
  getKeysStatus: vi.fn(() => ({
    cloud: { configured: true, provider: 'DeepSeek', model: 'test-model' },
    local: { configured: true, model: 'test-local' },
    embed: { configured: true, model: 'test-embed' },
    mtproto: { configured: false },
    botApi: { configured: false, channelLabel: null },
    activeModel: 'test-model',
    activeProvider: 'DeepSeek',
  })),
}));

vi.mock('../../lib/server/challenge', async () => {
  const { clean } = await import('@challenge/core/sanitize');
  const { msg } = await import('@challenge/core/types');
  return { clean, msg };
});

interface NewsRowLike {
  id: number;
  url: string;
  title: string;
  summary: string;
  published_at: string;
  source: string;
  used: number;
  created_at: string;
}

let POST: (req: NextRequest) => Promise<Response>;
let createSessionValue: () => string;
let newsSince: ReturnType<typeof vi.fn>;
let chat: ReturnType<typeof vi.fn>;
let pickLlmClient: ReturnType<typeof vi.fn>;
let getKeysStatus: ReturnType<typeof vi.fn>;
let getBlogDb: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  const mod = await import('../../app/api/blog/digest/generate/route');
  POST = mod.POST;
  const auth = await import('../../lib/auth');
  createSessionValue = auth.createSessionValue;
  const db = await import('../../lib/server/db');
  getBlogDb = vi.mocked(db.getBlogDb) as unknown as ReturnType<typeof vi.fn>;
  const llm = await import('../../lib/server/llm');
  pickLlmClient = vi.mocked(llm.pickLlmClient) as unknown as ReturnType<typeof vi.fn>;
  const env = await import('../../lib/server/env');
  getKeysStatus = vi.mocked(env.getKeysStatus) as unknown as ReturnType<typeof vi.fn>;
});

beforeEach(() => {
  newsSince = vi.fn().mockReturnValue([]);
  getBlogDb.mockReset().mockReturnValue({ newsSince });
  chat = vi.fn();
  pickLlmClient.mockReset().mockReturnValue({ chat });
});

function authed(): string {
  return `admin_session=${createSessionValue()}`;
}

function req(body: unknown, cookie?: string): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/blog/digest/generate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function row(i: number, over: Partial<NewsRowLike> = {}): NewsRowLike {
  return {
    id: i,
    url: `https://example.com/news-${i}`,
    title: `Новость ${i}`,
    summary: `Резюме новости ${i}`,
    published_at: new Date(Date.now() - i * 3600_000).toISOString(),
    source: 'rss',
    used: 0,
    created_at: new Date().toISOString(),
    ...over,
  };
}

interface DigestOk {
  ok: boolean;
  digest: string;
  newsCount: number;
  sources: Array<{ title: string; url: string }>;
  truncated: boolean;
}

describe('POST /api/blog/digest/generate', () => {
  it('без cookie → 401 (второй auth-слой), БД и LLM не трогаются', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: 'unauthorized' });
    expect(newsSince).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
  });

  it('с невалидной cookie → 401', async () => {
    const res = await POST(req({}, 'admin_session=999.deadbeef'));
    expect(res.status).toBe(401);
  });

  it('days: 0 → 400 zod (до выборки БД)', async () => {
    const res = await POST(req({ days: 0 }, authed()));
    expect(res.status).toBe(400);
    expect(newsSince).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
  });

  it('не-JSON тело деградирует в {} → валидный запрос: дефолтное окно → 409 пустого окна', async () => {
    // days опционален: пустое/битое тело = «собери за 7 дней», а не ошибка схемы
    // (отличие от tgPublishSchema, где text обязателен). Гарbage-body не роняет роут.
    const res = await POST(
      new NextRequest('http://127.0.0.1:3000/api/blog/digest/generate', {
        method: 'POST',
        headers: { cookie: authed() },
        body: 'not json',
      }),
    );
    expect(res.status).toBe(409);
    expect(newsSince).toHaveBeenCalledTimes(1);
    expect(chat).not.toHaveBeenCalled();
  });

  it('пустое окно → 409 empty-window с дефолтным окном в тексте, LLM не вызывается', async () => {
    const res = await POST(req({}, authed()));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok: boolean; error: string; errorKind: string };
    expect(body.ok).toBe(false);
    expect(body.errorKind).toBe('empty-window');
    expect(body.error).toContain('7');
    expect(chat).not.toHaveBeenCalled();
  });

  it('не-http(s) URL (javascript:) из tainted RSS дропается ДО промпта: нет ни в sources, ни в промпте', async () => {
    newsSince.mockReturnValue([row(1, { url: 'javascript:alert(1)' }), row(2)]);
    chat.mockResolvedValue('дайджест');

    const res = await POST(req({}, authed()));
    expect(res.status).toBe(200);

    const body = (await res.json()) as DigestOk;
    expect(body.newsCount).toBe(1);
    expect(body.sources).toEqual([{ title: 'Новость 2', url: 'https://example.com/news-2' }]);
    const messages = chat.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(messages[1]!.content).not.toContain('javascript:');
    expect(messages[1]!.content).toContain('https://example.com/news-2');
  });

  it('все URL окна не-http(s) → 409 empty-window, LLM не вызывается', async () => {
    newsSince.mockReturnValue([
      row(1, { url: 'data:text/html,hi' }),
      row(2, { url: 'not a url' }),
    ]);
    const res = await POST(req({}, authed()));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ ok: false, errorKind: 'empty-window' });
    expect(chat).not.toHaveBeenCalled();
  });

  it('days=3 → newsSince(now − 3 дня): окно по published_at пробрасывается', async () => {
    await POST(req({ days: 3 }, authed()));
    const sinceIso = newsSince.mock.calls[0]?.[0] as string;
    const diffDays = (Date.now() - new Date(sinceIso).getTime()) / 86_400_000;
    expect(diffDays).toBeGreaterThan(2.99);
    expect(diffDays).toBeLessThan(3.01);
  });

  it('ок → 200: digest от LLM, sources/newsCount из БД-выборки, truncated:false', async () => {
    newsSince.mockReturnValue([row(1), row(2)]);
    const draft = 'Дайджест недели\n- пункт — https://example.com/news-1\nПодборка по новостям недели';
    chat.mockResolvedValue(draft);

    const res = await POST(req({}, authed()));
    expect(res.status).toBe(200);

    const body = (await res.json()) as DigestOk;
    expect(body.ok).toBe(true);
    expect(body.digest).toBe(draft);
    expect(body.digest.length).toBeLessThanOrEqual(4096);
    expect(body.truncated).toBe(false);
    expect(body.newsCount).toBe(2);
    expect(body.sources).toEqual([
      { title: 'Новость 1', url: 'https://example.com/news-1' },
      { title: 'Новость 2', url: 'https://example.com/news-2' },
    ]);
    expect(pickLlmClient).toHaveBeenCalledWith('cloud');
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('промпт: system+user, в user — title/summary/url из выборки, tainted вычищен clean()-ом', async () => {
    newsSince.mockReturnValue([
      row(1, { title: 'Челси\u0000 обыграл соседа', summary: '  \u0007факт только из списка\u0007' }),
      row(2),
    ]);
    chat.mockResolvedValue('дайджест');

    await POST(req({}, authed()));

    expect(chat).toHaveBeenCalledTimes(1);
    const messages = chat.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).toContain('ТОЛЬКО');
    expect(messages[1]!.role).toBe('user');
    expect(messages[1]!.content).toContain('Челси обыграл соседа'); // \u0000 вырезан
    expect(messages[1]!.content).toContain('факт только из списка'); // \u0007 вырезан + trim
    expect(messages[1]!.content).toContain('https://example.com/news-1');
    expect(messages[1]!.content).toContain('https://example.com/news-2');
    expect(messages[1]!.content).not.toContain('\u0000');
    expect(messages[1]!.content).not.toContain('\u0007');
  });

  it('cap 60 свежайших: 70 строк в БД → в промпт и sources попадают 60', async () => {
    newsSince.mockReturnValue(Array.from({ length: 70 }, (_, i) => row(i + 1)));
    chat.mockResolvedValue('дайджест');

    const res = await POST(req({}, authed()));
    expect(res.status).toBe(200);

    const body = (await res.json()) as DigestOk;
    expect(body.newsCount).toBe(60);
    const messages = chat.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(messages[1]!.content).toContain('https://example.com/news-60');
    expect(messages[1]!.content).not.toContain('https://example.com/news-61');
  });

  it('LLM упал → 502 safeMessage: без URL/Bearer/ключей', async () => {
    newsSince.mockReturnValue([row(1)]);
    chat.mockRejectedValue(
      new Error('LLM API error 500: boom Bearer sk-secret123 https://api.deepseek.com'),
    );

    const res = await POST(req({}, authed()));
    expect(res.status).toBe(502);

    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).not.toContain('https://');
    expect(body.error).not.toContain('sk-secret');
  });

  it('LLM вернул пустоту → 502 (guard «непустой» до clamp)', async () => {
    newsSince.mockReturnValue([row(1)]);
    chat.mockResolvedValue('   ');

    const res = await POST(req({}, authed()));
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({ ok: false });
  });

  it('LLM вернул >4096 → обрезка по границе строки, ≤4096, truncated:true', async () => {
    newsSince.mockReturnValue([row(1)]);
    const lines = Array.from(
      { length: 300 },
      (_, i) => `Пункт ${i + 1} — подробный текст про Челси и АПЛ с фактом из списка — https://example.com/news-${i + 1}`,
    );
    chat.mockResolvedValue(lines.join('\n'));

    const res = await POST(req({}, authed()));
    expect(res.status).toBe(200);

    const body = (await res.json()) as DigestOk;
    expect(body.truncated).toBe(true);
    expect(body.digest.length).toBeLessThanOrEqual(4096);
    expect(body.digest.endsWith(' …')).toBe(true);
    // Граница строки: без хвостового ' …' дайджест кончается целой исходной строкой.
    const withoutEllipsis = body.digest.slice(0, -2);
    expect(lines.some((l) => withoutEllipsis.endsWith(l))).toBe(true);
  });

  it('cloud не настроен → фолбэк local (прецедент /api/demo/rag)', async () => {
    getKeysStatus.mockReturnValueOnce({
      cloud: { configured: false },
      local: { configured: true, model: 'test-local' },
      embed: { configured: true, model: 'test-embed' },
      mtproto: { configured: false },
      botApi: { configured: false, channelLabel: null },
      activeModel: 'test-local',
      activeProvider: 'Ollama',
    });
    newsSince.mockReturnValue([row(1)]);
    chat.mockResolvedValue('дайджест');

    const res = await POST(req({}, authed()));
    expect(res.status).toBe(200);
    expect(pickLlmClient).toHaveBeenCalledWith('local');
    await expect(res.json()).resolves.toMatchObject({ ok: true, digest: 'дайджест' });
  });
});
