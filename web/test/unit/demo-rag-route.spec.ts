// Unit: Route Handler POST /api/demo/rag — публичный RAG-эндпоинт страницы /demo.
// Контракт §2 (заморожен): 400 zod / 429 + Retry-After / 200 {ok,answer,gaveUp,
// sources:[{n,title,section,snippet,score}]} БЕЗ tg-метаданных / 502 c safeMessage /
// 503 без ключей. Retriever/answerWithRag/withDb/env/llm мокаются; server-only
// застаблен в vitest.config; clean() — реальный (чистый модуль core/sanitize).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import type { RagAnswer, ScoredChunk } from '../../lib/server/challenge';

vi.mock('../../lib/server/db', () => ({
  getRagStore: vi.fn(() => ({}) as never),
  withDb: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../../lib/server/llm', () => ({
  pickLlmClient: vi.fn(() => ({ chat: vi.fn() })),
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
  return {
    Retriever: vi.fn(),
    makeEmbedder: vi.fn(() => ({ dim: 4096, embed: vi.fn() })),
    answerWithRag: vi.fn(),
    clean,
  };
});

let POST: (req: NextRequest) => Promise<Response>;
let answerWithRag: ReturnType<typeof vi.fn>;
let pickLlmClient: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  const mod = await import('../../app/api/demo/rag/route');
  POST = mod.POST;
  const challenge = await import('../../lib/server/challenge');
  answerWithRag = vi.mocked(challenge.answerWithRag) as unknown as ReturnType<typeof vi.fn>;
  const llm = await import('../../lib/server/llm');
  pickLlmClient = vi.mocked(llm.pickLlmClient) as unknown as ReturnType<typeof vi.fn>;
});

beforeEach(() => {
  answerWithRag.mockReset();
  pickLlmClient.mockClear();
  // Сброс in-memory rate-limit окон роута между тестами.
  const g = globalThis as unknown as {
    __demoRagRate?: { ips: Map<string, unknown>; total: { count: number; resetAt: number } };
  };
  if (g.__demoRagRate) {
    g.__demoRagRate.ips.clear();
    g.__demoRagRate.total.count = 0;
    g.__demoRagRate.total.resetAt = 0;
  }
});

function req(body: unknown): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/demo/rag', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function scored(
  source: string,
  text: string,
  score: number,
  meta: { title?: string; section?: string } = {},
): ScoredChunk {
  return {
    score,
    chunk: {
      text,
      metadata: {
        source,
        title: meta.title ?? 'T',
        section: meta.section ?? 'S',
        chunkId: `${source}::0`,
      },
    },
  };
}

function ragResult(over: {
  answer: string;
  sources?: ScoredChunk[];
  gaveUp?: boolean;
}): RagAnswer {
  const size = over.sources?.length ?? 0;
  return {
    answer: over.answer,
    sources: over.sources ?? [],
    debug: {
      poolSize: size,
      filteredSize: size,
      threshold: 0.5,
      rerankApplied: false,
      fallback: false,
      rankDelta: 0,
      rewritten: false,
      gaveUp: over.gaveUp ?? false,
    },
  };
}

describe('POST /api/demo/rag', () => {
  it('пустой вопрос (после trim) → 400 zod, до RAG не доходит', async () => {
    const res = await POST(req({ question: '   ' }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: 'Введите вопрос' });
    expect(answerWithRag).not.toHaveBeenCalled();
  });

  it('вопрос длиннее 300 символов → 400', async () => {
    const res = await POST(req({ question: 'в'.repeat(301) }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain('максимум 300 символов');
    expect(answerWithRag).not.toHaveBeenCalled();
  });

  it('не-JSON тело → 400', async () => {
    const res = await POST(
      new NextRequest('http://127.0.0.1:3000/api/demo/rag', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rate-limit: 7-й запрос с одного IP → 429 с Retry-After, RAG не вызывается', async () => {
    answerWithRag.mockResolvedValue(ragResult({ answer: 'ок' }));
    for (let i = 0; i < 6; i++) {
      const res = await POST(req({ question: `вопрос ${i}` }));
      expect(res.status).toBe(200);
    }
    const res = await POST(req({ question: 'ещё вопрос' }));
    expect(res.status).toBe(429);
    const retryAfter = res.headers.get('retry-after');
    expect(retryAfter).not.toBeNull();
    expect(Number(retryAfter)).toBeGreaterThan(0);
    const body = (await res.json()) as { ok: boolean; error: string; retryAfterSec: number };
    expect(body.ok).toBe(false);
    expect(body.retryAfterSec).toBe(Number(retryAfter));
    expect(body.error).toContain('Слишком много вопросов');
    expect(answerWithRag).toHaveBeenCalledTimes(6);
  });

  it('глобальный fuse сработал → 429 без создания новых IP-окон (спуфинг XFF не надувает Map)', async () => {
    answerWithRag.mockResolvedValue(ragResult({ answer: 'ок' }));
    let ok = 0;
    let limited = 0;
    // 100 уникальных XFF при глобальном лимите 60: первые 60 проходят, дальше 429.
    for (let i = 1; i <= 100; i++) {
      const res = await POST(
        new NextRequest('http://127.0.0.1:3000/api/demo/rag', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${i}` },
          body: JSON.stringify({ question: `вопрос ${i}` }),
        }),
      );
      if (res.status === 200) ok += 1;
      else if (res.status === 429) limited += 1;
    }
    expect(ok).toBe(60);
    expect(limited).toBe(40);
    // Запись успевают создать только 61 IP (60 успешных + 1 на первом 429);
    // запросы под сработавшим fuse карту не растят (до раннего 429 было бы 100).
    const g = globalThis as unknown as {
      __demoRagRate?: { ips: Map<string, unknown> };
    };
    expect(g.__demoRagRate?.ips.size).toBe(61);
  });

  it('успех → 200: контракт {ok,answer,gaveUp,sources}, без source/chunkId/tg-метаданных', async () => {
    answerWithRag.mockResolvedValue(
      ragResult({
        answer: 'Крышка открывается кнопкой [1].',
        sources: [
          scored(
            'evolute-i-space-2025.md',
            'Крышка багажного отсека открывается кнопкой на двери водителя. '.repeat(4),
            0.83,
            { title: '-IV-', section: '-IV-' },
          ),
          // В structure-партиции такого быть не может — проверяем страховочный фильтр.
          scored('tg://chat/-100123/42', 'tg-чанк', 0.51, { title: 'TG chat' }),
        ],
      }),
    );
    // llm/strategy из запроса приходят — сервер обязан их игнорировать.
    const res = await POST(req({ question: 'Как открыть крышку багажника?', llm: 'local' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');

    const body = (await res.json()) as {
      ok: boolean;
      answer: string;
      gaveUp: boolean;
      sources: Array<Record<string, unknown>>;
    };
    expect(body.ok).toBe(true);
    expect(body.gaveUp).toBe(false);
    expect(body.answer).toBe('Крышка открывается кнопкой [1].');
    expect(body.sources).toHaveLength(1);
    expect(Object.keys(body.sources[0]!).sort()).toEqual(['n', 'score', 'section', 'snippet', 'title']);
    expect(body.sources[0]!.n).toBe(1);
    expect((body.sources[0]!.snippet as string).length).toBeLessThanOrEqual(200);

    // Инвариант плана §4.7: ни tg://, ни telegram нигде в теле ответа.
    const raw = JSON.stringify(body).toLowerCase();
    expect(raw).not.toContain('tg://');
    expect(raw).not.toContain('telegram');

    // Выбор LLM серверный: cloud-first (фолбэк local), поле llm игнорируется.
    expect(pickLlmClient).toHaveBeenCalledWith('cloud');
  });

  it('guard → 200 с gaveUp=true, sources=[] и честным «Не знаю»', async () => {
    const { GUARD_ANSWER } = await import('@challenge/core/rag/rag');
    answerWithRag.mockResolvedValue(ragResult({ answer: GUARD_ANSWER, gaveUp: true }));
    const res = await POST(req({ question: 'Кто выиграл чемпионат мира по футболу?' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; answer: string; gaveUp: boolean; sources: unknown[] };
    expect(body).toMatchObject({ ok: true, answer: GUARD_ANSWER, gaveUp: true, sources: [] });
  });

  it('LLM упал (fetch failed) → 502 человекочитаемый, без URL/Bearer/ключей', async () => {
    answerWithRag.mockRejectedValue(
      new Error('fetch failed: https://api.deepseek.com/chat/completions Bearer sk-secret123'),
    );
    const res = await POST(req({ question: 'Как включить подогрев сидений?' }));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain('База знаний временно недоступна');
    expect(body.error).not.toContain('https://');
    expect(body.error).not.toContain('sk-secret');
  });

  it('LLM не настроен нигде → 503 до RAG', async () => {
    const env = await import('../../lib/server/env');
    vi.mocked(env.getKeysStatus).mockReturnValueOnce({
      cloud: { configured: false },
      local: { configured: false },
      embed: { configured: true, model: 'test-embed' },
      mtproto: { configured: false },
      botApi: { configured: false, channelLabel: null },
      activeModel: null,
      activeProvider: null,
    });
    const res = await POST(req({ question: 'Как включить подогрев сидений?' }));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ ok: false });
    expect(answerWithRag).not.toHaveBeenCalled();
  });
});
