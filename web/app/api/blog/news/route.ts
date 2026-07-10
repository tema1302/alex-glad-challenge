// SSE Route Handler: блог-pipeline news (RSS → агент 1 → агент 2 → агент 3 → пост).
// День 28, web P4a. runtime=nodejs, force-dynamic. Логика server-only: все импорты core/
// идут через web/lib/server/* chokepoint (client bundle физически не получает core/).
//
// runNewsPipeline не имеет onProgress-колбэка, поэтому SSE отдаёт только start → done/error
// (задача P4a допускает). По завершении пост уже в blog.sqlite (insertPost внутри pipeline).
// Контракт событий (web/lib/shared/sse.ts):
//   {type:'stage',  step:'start'}                                   — старт pipeline
//   {type:'done',   post, topNews, verdict}                         — финал (post может быть null)
//   {type:'error',  message}                                        — обобщённое сообщение БЕЗ URL/ключа/пути
import 'server-only';
import { NextRequest } from 'next/server';

import { newsOptsSchema } from '../../../../lib/shared/forms';
import type { SseBlogNewsEvent } from '../../../../lib/shared/sse';
import { pickLlmClient } from '../../../../lib/server/llm';
import { getBlogDb, withDb } from '../../../../lib/server/db';
import { runNewsPipeline, ProfileManager, dataPath } from '../../../../lib/server/challenge';
import { safeMessage } from '../../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const parsed = newsOptsSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: parsed.error.issues[0]?.message ?? 'invalid request' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const { hours, top, forIndex, llm = 'cloud' } = parsed.data;
  const client = pickLlmClient(llm);

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: SseBlogNewsEvent): void => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };
      try {
        send({ type: 'stage', step: 'start' });

        // Профиль — зеркало cli runNewsCommand: default | первый | создать default.
        const profile = new ProfileManager(dataPath('profiles'));
        const names = profile.list();
        if (names.length > 0) {
          profile.load(names.includes('default') ? 'default' : names[0]);
        } else {
          profile.create('default');
        }

        // withDb удерживает mutex на весь pipeline (sync DatabaseSync-вызовы + LLM).
        // Для 1-юзер локально приемлемо (R4, план §6) — то же, что в /api/rag/query.
        // id вставленного поста — через recentPosts(1) внутри той же блокировки (гонки нет).
        const { result, postId } = await withDb(async () => {
          const r = await runNewsPipeline(getBlogDb(), client, {
            maxAgeHours: hours,
            topK: top,
            writeForIndex: forIndex,
            profile,
            signal: req.signal,
          });
          let pid: number | null = null;
          if (r.post) {
            const last = getBlogDb().recentPosts(1)[0];
            if (last) pid = last.id;
          }
          return { result: r, postId: pid };
        });

        send({
          type: 'done',
          post: result.post ? { id: postId ?? 0, content: result.post.content } : null,
          topNews: result.news.ranked.map((r) => ({
            title: r.news.title,
            score: r.score,
            why: r.why,
          })),
          verdict: result.factCheck?.verdict ?? null,
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
