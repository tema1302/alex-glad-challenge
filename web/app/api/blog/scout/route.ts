// SSE Route Handler: блог-scout — 3 source-агента (RSS/Forum/TG) → оркестратор (день 28, P4b).
// runtime=nodejs, force-dynamic, server-only. Все импорты core/ — через web/lib/server/*
// chokepoint (client bundle физически не получает core/).
//
// runSourceAgents не имеет onProgress-колбэка (Promise.all + console.log внутри), поэтому
// SSE отдаёт start → done/error (аналог /api/blog/news). В done — финальный топ оркестратора
// + сводка по каждому source-агенту (rawResults: имя/кол-во тем/ошибка).
//
// enableTelegram по умолчанию ВЫКЛЮЧЕН: MTProto-путь (TG_SESSION) credential-тяжёлый и
// требует настроенной сессии. Forum по умолчанию ВКЛ (HTTP, без credentials). Пользователь
// может явно включить TG чекбоксом.
//
// Контракт событий (web/lib/shared/sse.ts):
//   {type:'stage', step:'start'}
//   {type:'done', ranked, agents}
//   {type:'error', message}
import 'server-only';
import { NextRequest } from 'next/server';

import { scoutOptsSchema } from '../../../../lib/shared/forms';
import type { SseBlogScoutEvent } from '../../../../lib/shared/sse';
import { pickLlmClient } from '../../../../lib/server/llm';
import { getBlogDb, withDb } from '../../../../lib/server/db';
import { runSourceAgents } from '../../../../lib/server/challenge';
import { safeMessage } from '../../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const parsed = scoutOptsSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: parsed.error.issues[0]?.message ?? 'invalid request' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const { hours, topK, query, llm = 'cloud' } = parsed.data;
  // TG по умолчанию выкл (MTProto), Forum по умолчанию вкл — см. шапку.
  const enableTelegram = parsed.data.enableTelegram ?? false;
  const enableForum = parsed.data.enableForum ?? true;
  const client = pickLlmClient(llm);

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: SseBlogScoutEvent): void => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };
      try {
        send({ type: 'stage', step: 'start' });

        // withDb сериализует DatabaseSync-вызовы (RssSourceAgent дедуплит новости через BlogDb).
        // runSourceAgents: RSS + Forum (+ TG если вкл) параллельно, затем LLM-оркестратор.
        const result = await withDb(() =>
          runSourceAgents(getBlogDb(), client, {
            maxAgeHours: hours,
            topK,
            userQuery: query,
            enableTelegram,
            enableForum,
            signal: req.signal,
          }),
        );

        send({
          type: 'done',
          ranked: result.ranked.map((t) => ({
            title: t.title,
            source: t.source,
            hypeScore: t.hypeScore,
            hypeReason: t.hypeReason,
            orchestratorScore: t.orchestratorScore,
            orchestratorReason: t.orchestratorReason,
            url: t.url ?? null,
          })),
          agents: result.rawResults.map((r) => ({
            agent: r.agent,
            count: r.topics.length,
            error: r.error ?? null,
          })),
        });
      } catch (e) {
        const message = e instanceof Error ? safeMessage(e.message) : 'internal error';
        send({ type: 'error', message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
