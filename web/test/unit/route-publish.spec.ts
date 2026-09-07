// Unit: Route Handler POST /api/telegram/publish — второй auth-слой (requireAuth),
// zod-схема, rate-limit на сессию, делегирование в publishToTelegram.
// tg-publish мокается; auth — реальный (HMAC-cookie на тестовых env).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';

vi.mock('../../lib/server/tg-publish', () => ({
  publishToTelegram: vi.fn(),
  tgPublishResponse: vi.fn(),
  tgRateLimit: vi.fn(),
}));

let POST: (req: NextRequest) => Promise<Response>;
let createSessionValue: () => string;
let publishToTelegram: ReturnType<typeof vi.fn>;
let tgPublishResponse: ReturnType<typeof vi.fn>;
let tgRateLimit: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  const mod = await import('../../app/api/telegram/publish/route');
  POST = mod.POST;
  const auth = await import('../../lib/auth');
  createSessionValue = auth.createSessionValue;
  const tg = await import('../../lib/server/tg-publish');
  publishToTelegram = vi.mocked(tg.publishToTelegram);
  tgPublishResponse = vi.mocked(tg.tgPublishResponse);
  tgRateLimit = vi.mocked(tg.tgRateLimit);
});

beforeEach(() => {
  publishToTelegram.mockReset();
  tgPublishResponse.mockReset().mockImplementation(
    (outcome: { ok: boolean; messageId?: number }) =>
      new Response(JSON.stringify(outcome), { status: outcome.ok ? 200 : 502 }),
  );
  tgRateLimit.mockReset().mockReturnValue({ ok: true });
});

function req(body: unknown, cookie?: string): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/telegram/publish', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/telegram/publish', () => {
  it('без cookie → 401 JSON (второй auth-слой, даже если middleware пропустил)', async () => {
    const res = await POST(req({ text: 'привет' }));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: 'unauthorized' });
    expect(publishToTelegram).not.toHaveBeenCalled();
  });

  it('с невалидной cookie → 401', async () => {
    const res = await POST(req({ text: 'привет' }, 'admin_session=999.deadbeef'));
    expect(res.status).toBe(401);
  });

  it('пустой текст → 400 zod-валидация (до publish)', async () => {
    const res = await POST(req({ text: '   ' }, `admin_session=${createSessionValue()}`));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('Текст обязателен');
    expect(publishToTelegram).not.toHaveBeenCalled();
  });

  it('валидный запрос → publishToTelegram("manual", HTML) → tgPublishResponse', async () => {
    publishToTelegram.mockResolvedValue({ ok: true, messageId: 42 });
    const res = await POST(req({ text: '<b>привет</b>' }, `admin_session=${createSessionValue()}`));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, messageId: 42 });
    expect(publishToTelegram).toHaveBeenCalledWith('<b>привет</b>', 'manual', undefined, 'HTML');
  });

  it('parseMode none пробрасывается', async () => {
    publishToTelegram.mockResolvedValue({ ok: true, messageId: 1 });
    await POST(req({ text: 'текст', parseMode: 'none' }, `admin_session=${createSessionValue()}`));
    expect(publishToTelegram).toHaveBeenCalledWith('текст', 'manual', undefined, 'none');
  });

  it('rate-limit: превышение → 429 с retryAfter, publish не вызывается', async () => {
    tgRateLimit.mockReturnValue({ ok: false, retryAfterSec: 33 });
    const res = await POST(req({ text: 'привет' }, `admin_session=${createSessionValue()}`));

    expect(res.status).toBe(429);
    const body = (await res.json()) as { errorKind?: string; retryAfter?: number };
    expect(body.errorKind).toBe('rate-limit');
    expect(body.retryAfter).toBe(33);
    expect(publishToTelegram).not.toHaveBeenCalled();
  });

  it('не-JSON тело → 400 схемы', async () => {
    const res = await POST(
      new NextRequest('http://127.0.0.1:3000/api/telegram/publish', {
        method: 'POST',
        headers: { cookie: `admin_session=${createSessionValue()}` },
        body: 'not json',
      }),
    );
    expect(res.status).toBe(400);
  });
});
