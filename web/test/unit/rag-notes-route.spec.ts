// Unit: Route Handler /api/rag/notes (POST/DELETE/GET) — «База знаний», партиция 'notes'.
// requireAuth — реальный (HMAC-cookie на тестовых env, прецедент route-publish.spec.ts);
// db (getRagStore/withDb) и chokepoint (ingestNote/makeEmbedder) мокаются по образцу
// demo-rag-route.spec.ts; clean() — реальный (чистый модуль core/sanitize).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';

const mocks = vi.hoisted(() => ({
  ingestNote: vi.fn(),
  count: vi.fn(),
  deleteBySource: vi.fn(),
  listNotes: vi.fn(),
}));

vi.mock('../../lib/server/db', () => ({
  getRagStore: vi.fn(() => ({
    count: mocks.count,
    deleteBySource: mocks.deleteBySource,
    listNotes: mocks.listNotes,
  })),
  withDb: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../../lib/server/challenge', async () => {
  const { clean } = await import('@challenge/core/sanitize');
  return {
    clean,
    ingestNote: mocks.ingestNote,
    makeEmbedder: vi.fn(() => ({ dim: 4096, embed: vi.fn() })),
  };
});

let POST: (req: NextRequest) => Promise<Response>;
let DELETE: (req: NextRequest) => Promise<Response>;
let GET: (req: NextRequest) => Promise<Response>;
let createSessionValue: () => string;

beforeAll(async () => {
  const mod = await import('../../app/api/rag/notes/route');
  POST = mod.POST;
  DELETE = mod.DELETE;
  GET = mod.GET;
  const auth = await import('../../lib/auth');
  createSessionValue = auth.createSessionValue;
});

const PARTITIONS = { fixed: 10, structure: 553, telegram: 6998, notes: 5, docs: 42, faq: 12 };
const NOTES = [
  { source: 'note://alfa-1a', title: 'Альфа', chunks: 3 },
  { source: 'note://beta-2b', title: 'Бета', chunks: 2 },
];

beforeEach(() => {
  mocks.ingestNote.mockReset();
  mocks.deleteBySource.mockReset();
  mocks.listNotes.mockReset();
  mocks.count
    .mockReset()
    .mockImplementation((s: string) => PARTITIONS[s as keyof typeof PARTITIONS] ?? 0);
});

function cookieValue(): string {
  return `admin_session=${createSessionValue()}`;
}

function jsonReq(method: 'POST' | 'DELETE', body: unknown, cookie?: string): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/rag/notes', {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/rag/notes', () => {
  it('без куки → 401 JSON (второй auth-слой), ingestNote не вызывается', async () => {
    const res = await POST(jsonReq('POST', { title: 'Т', text: 'Текст' }));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: 'unauthorized' });
    expect(mocks.ingestNote).not.toHaveBeenCalled();
  });

  it('JSON-заметка → 200 {ok, source: note://…, title, chunks>0}; clean() применён', async () => {
    mocks.ingestNote.mockResolvedValue({
      source: 'note://testovaya-zametka-1a2b',
      title: 'Тестовая заметка',
      chunks: 2,
    });
    const res = await POST(
      jsonReq('POST', { title: '  Тестовая заметка\n', text: '  Текст заметки  ' }, cookieValue()),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; source: string; title: string; chunks: number };
    expect(body.ok).toBe(true);
    expect(body.source).toMatch(/^note:\/\//);
    expect(body.title).toBe('Тестовая заметка');
    expect(body.chunks).toBeGreaterThan(0);

    // clean() на tainted: control-chars/trim до ингеста; store/embedder из chokepoint.
    expect(mocks.ingestNote).toHaveBeenCalledTimes(1);
    const [store, embedder, note] = mocks.ingestNote.mock.calls[0] as unknown as [
      unknown,
      unknown,
      { title: string; text: string },
    ];
    expect(store).toBeDefined();
    expect(embedder).toBeDefined();
    expect(note).toEqual({ title: 'Тестовая заметка', text: 'Текст заметки' });
  });

  it('multipart-файл (.txt) → 200; title из имени файла, текст через TextDecoder', async () => {
    mocks.ingestNote.mockResolvedValue({ source: 'note://marker-9c', title: 'marker', chunks: 1 });
    const form = new FormData();
    form.set('file', new File(['# Заголовок\n\nтекст маркера'], 'marker.txt', { type: 'text/plain' }));
    const res = await POST(
      new NextRequest('http://127.0.0.1:3000/api/rag/notes', {
        method: 'POST',
        headers: { cookie: cookieValue() },
        body: form,
      }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, title: 'marker', chunks: 1 });
    expect(mocks.ingestNote.mock.calls[0]?.[2]).toEqual({ title: 'marker', text: '# Заголовок\n\nтекст маркера' });
  });

  it('multipart с чужим расширением (.pdf) → 415', async () => {
    const form = new FormData();
    form.set('file', new File(['x'], 'table.pdf', { type: 'application/pdf' }));
    const res = await POST(
      new NextRequest('http://127.0.0.1:3000/api/rag/notes', {
        method: 'POST',
        headers: { cookie: cookieValue() },
        body: form,
      }),
    );
    expect(res.status).toBe(415);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain('.txt');
    expect(mocks.ingestNote).not.toHaveBeenCalled();
  });

  it('пустой title → 400 zod, ingestNote не вызывается', async () => {
    const res = await POST(jsonReq('POST', { title: '   ', text: 'Текст' }, cookieValue()));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('Введите заголовок заметки');
    expect(mocks.ingestNote).not.toHaveBeenCalled();
  });

  it('dim-mismatch от ingestNote → 502 safeMessage (без URL/ключей)', async () => {
    mocks.ingestNote.mockRejectedValue(
      new Error('векторы другой размерности: база заметок собрана другой моделью (index dim=4, новые=3)'),
    );
    const res = await POST(jsonReq('POST', { title: 'Т', text: 'Текст' }, cookieValue()));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain('векторы другой размерности');
    expect(body.error).not.toMatch(/https?:\/\//);
    expect(body.error).not.toContain('sk-');
  });
});

describe('DELETE /api/rag/notes', () => {
  it('без куки → 401', async () => {
    const res = await DELETE(jsonReq('DELETE', { source: 'note://abc' }));
    expect(res.status).toBe(401);
    expect(mocks.deleteBySource).not.toHaveBeenCalled();
  });

  it('чужая партиция (не note://) → 400, до SQL', async () => {
    const res = await DELETE(jsonReq('DELETE', { source: 'tg://chat/-100123/42/0-9' }, cookieValue()));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain('note://');
    expect(mocks.deleteBySource).not.toHaveBeenCalled();
  });

  it('note://source → 200 {ok, deleted}; deleteBySource("notes", source)', async () => {
    mocks.deleteBySource.mockReturnValue(3);
    const res = await DELETE(jsonReq('DELETE', { source: 'note://alfa-1a' }, cookieValue()));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, deleted: 3 });
    expect(mocks.deleteBySource).toHaveBeenCalledWith('notes', 'note://alfa-1a');
  });
});

describe('GET /api/rag/notes', () => {
  it('без куки → 401', async () => {
    const res = await GET(new NextRequest('http://127.0.0.1:3000/api/rag/notes'));
    expect(res.status).toBe(401);
    expect(mocks.count).not.toHaveBeenCalled();
  });

  it('с кукой → счётчики всех 6 партиций + список заметок, без tg-метаданных', async () => {
    mocks.listNotes.mockReturnValue(NOTES);
    const res = await GET(new NextRequest('http://127.0.0.1:3000/api/rag/notes', {
      headers: { cookie: cookieValue() },
    }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      partitions: Record<string, number>;
      notes: Array<{ source: string; title: string; chunks: number }>;
    };
    expect(body.ok).toBe(true);
    expect(body.partitions).toEqual(PARTITIONS);
    expect(body.notes).toEqual(NOTES);
    // count вызван ровно для 6 партиций.
    const counted = mocks.count.mock.calls.map((c) => c[0]).sort();
    expect(counted).toEqual(['docs', 'faq', 'fixed', 'notes', 'structure', 'telegram']);
    // Инвариант: ни tg://, ни списка tg-чатов в теле ответа.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('tg://');
    expect(body).not.toHaveProperty('telegramChats');
  });
});
