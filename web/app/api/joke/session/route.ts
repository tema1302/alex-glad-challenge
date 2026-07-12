// /api/joke/session — stateful multi-turn кино-шутник. web, slug joke-chat.
// GET  : ensure single joker-session + load → { session }.
// POST : SSE {token → done(usage)} | error. executeChat с persona-opt'ами (bare/fewShot/knobs/clean).
// PATCH: { reset:true } → clearMessages + usage=0.
//
// Шаблон: гибрид api/joke/route.ts (75с-timeout + req.signal в одном AbortController) и
// api/chat/[sessionId]/route.ts (GET/PATCH + executeChat + SSE-обёртка).
//
// Security: (1) zod на входе (text 1..8000, temperature 0.3..1.2); (2) llm жёстко 'local'
// (cloud-ветка не активируется — поле llm не принимается); (3) AbortSignal/timeout 75с;
// (4) safeMessage в catch — без секрета/URL/пути; (5) clean() на ответе (opt-gate в executeChat).
import 'server-only';
import { NextRequest } from 'next/server';
import { z } from 'zod';

import type { SseEvent } from '../../../../lib/shared/sse';
import { executeChat } from '../../../../lib/server/chat-adapter';
import { getWebSessionStore, ensureJokerSession } from '../../../../lib/server/web-session-store';
import { withDb } from '../../../../lib/server/db';
import { safeMessage } from '../../../../lib/server/safe-message';
import { JOKER_SYSTEM, JOKER_FEWSHOT, JOKER_KNOBS } from '../../../../lib/server/joke-persona';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Серверный cap 60-90с (security §2): при зависшей Ollama route обрывается сам.
const TIMEOUT_MS = 75_000;

const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
};

// Локальная схема (forms.ts от joke-схем очищен). llm НЕ принимается — жёстко 'local'.
const jokeSendSchema = z.object({
  text: z.string().trim().min(1, 'Введите сообщение').max(8000, 'Слишком длинное сообщение'),
  temperature: z.coerce.number().min(0.3, 'temp: 0.3..1.2').max(1.2, 'temp: 0.3..1.2').optional(),
});

const jokeResetSchema = z.object({
  reset: z.boolean().optional(),
});

export async function GET(): Promise<Response> {
  const sessionId = await ensureJokerSession(JOKER_SYSTEM);
  const data = await withDb(() => getWebSessionStore().load(sessionId));
  if (!data) return Response.json({ error: 'Сессия не найдена' }, { status: 404 });
  return Response.json({ session: data });
}

export async function POST(req: NextRequest): Promise<Response> {
  const parsed = jokeSendSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  const { text, temperature } = parsed.data;

  // ensure joker-сессии до стрима (executeChat внутри тоже load'ит по тому же id).
  const sessionId = await ensureJokerSession(JOKER_SYSTEM);

  // knobs: JOKER_KNOBS (temp 0.9) + опц. temperature из UI-слайдера (переопределяет).
  const knobs = temperature !== undefined ? { ...JOKER_KNOBS, temperature } : JOKER_KNOBS;

  // Один AbortController на два триггера: disconnect клиента (req.signal) + серверный timeout.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  if (req.signal.aborted) ac.abort();
  else req.signal.addEventListener('abort', () => ac.abort(), { once: true });

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: SseEvent): void => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };
      try {
        for await (const ev of executeChat(sessionId, text, {
          llm: 'local',
          signal: ac.signal,
          systemBehavior: 'bare',
          fewShot: JOKER_FEWSHOT,
          knobs,
          clean: true,
        })) {
          send(ev);
        }
      } catch (e) {
        // Backstop: executeChat сама yield'ит error, но guard от неожиданного throw.
        const message = e instanceof Error ? safeMessage(e.message) : 'internal error';
        send({ type: 'error', message });
      } finally {
        clearTimeout(timer);
        controller.close();
      }
    },
  });

  return new Response(body, { headers: SSE_HEADERS });
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const parsed = jokeResetSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  const sessionId = await ensureJokerSession(JOKER_SYSTEM);
  await withDb(() => {
    const s = getWebSessionStore();
    if (parsed.data.reset) {
      s.clearMessages(sessionId);
      s.updateSession(sessionId, { usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
    }
  });
  const data = await withDb(() => getWebSessionStore().load(sessionId));
  if (!data) return Response.json({ error: 'Сессия не найдена' }, { status: 404 });
  return Response.json({ session: data });
}
