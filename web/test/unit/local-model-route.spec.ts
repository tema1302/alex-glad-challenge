// Unit: Route Handler /api/local-model — GET состояние, POST переключение
// (day-10 s3). Граница — реальный local-model-switch; env выставляем в тесте.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const BASE = 'qwen2.5-coder:1.5b-base';
const TUNED = 'qwen2.5-coder-1.5b-distilled';

let GET: () => Promise<Response>;
let POST: (req: NextRequest) => Promise<Response>;

beforeAll(async () => {
  ({ GET, POST } = await import('../../app/api/local-model/route'));
});

beforeEach(() => {
  vi.resetModules();
  process.env.LOCAL_LLM_MODEL = BASE;
  process.env.LOCAL_LLM_TUNED_MODEL = TUNED;
});

function req(body: unknown): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/local-model', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/local-model', () => {
  it('отдаёт состояние переключателя', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      ok: true, base: BASE, tuned: TUNED, active: BASE, switchable: true,
    });
  });
});

describe('POST /api/local-model', () => {
  it('переключает на tuned', async () => {
    const res = await POST(req({ model: TUNED }));
    expect(res.status).toBe(200);
    expect((await res.json()).active).toBe(TUNED);
  });

  it('сброс через "base"', async () => {
    await POST(req({ model: TUNED }));
    const res = await POST(req({ model: 'base' }));
    expect((await res.json()).active).toBe(BASE);
  });

  it('400 на невалидном теле', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it('400 на чужом имени модели', async () => {
    const res = await POST(req({ model: 'evil/model' }));
    expect(res.status).toBe(400);
  });

  it('409 когда tuned не задана', async () => {
    delete process.env.LOCAL_LLM_TUNED_MODEL;
    vi.resetModules();
    const { GET: GET2, POST: POST2 } = await import(
      '../../app/api/local-model/route');
    expect((await GET2()).json && (await (await GET2()).json()).switchable)
      .toBe(false);
    const res = await POST2(req({ model: TUNED }));
    expect(res.status).toBe(409);
  });
});
