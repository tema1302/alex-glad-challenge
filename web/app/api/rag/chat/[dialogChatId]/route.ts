// /api/rag/chat/[dialogChatId] — RAG-чат поверх DialogDb. web P3a.
// GET   → история + task state + мета чата (для hydration UI при reload).
// POST  → SSE: stage → token → done(источники/цитаты/debug) | error. (executeRagChat)
// PATCH → rename(title) / /task <desc> (set goal) / /task-clear.
// zod на входе; safeMessage обобщает error без секрета/URL/пути.
import 'server-only';
import { NextRequest } from 'next/server';
import {
  ragChatSendSchema,
  ragChatPatchSchema,
} from '../../../../../lib/shared/forms';
import type { SseEvent } from '../../../../../lib/shared/sse';
import { executeRagChat, renderTaskStateForUi } from '../../../../../lib/server/rag-chat-adapter';
import type { SerializedTaskState } from '../../../../../lib/server/challenge';
import { getDialogDb, withDb } from '../../../../../lib/server/db';
import { safeMessage } from '../../../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ dialogChatId: string }> };

// /task <desc>: вернуть state с обновлённым goal, сохранив прочие секции. DialogDb.upsertTaskState
// принимает собранный state — собираем здесь, не плодя метод в core/ (surgical: challenge/ не трогаем).
function withGoal(prev: SerializedTaskState | null, goal: string): SerializedTaskState {
  return {
    goal,
    terms: prev?.terms ?? {},
    constraints: prev?.constraints ?? [],
    clarifications: prev?.clarifications ?? [],
  };
}

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const { dialogChatId } = await ctx.params;
  const data = await withDb(() => {
    const dialog = getDialogDb();
    const chat = dialog.getChat(dialogChatId);
    if (!chat) return null;
    const messages = dialog.listMessages(dialogChatId, 500);
    const taskState = dialog.loadTaskState(dialogChatId);
    return { chat, messages, taskStateText: renderTaskStateForUi(taskState) };
  });
  if (!data) return Response.json({ error: 'Чат не найден' }, { status: 404 });
  return Response.json(data);
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { dialogChatId } = await ctx.params;
  const parsed = ragChatSendSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  const { text, strategy, k, llm, chatKey, topicId, noRag } = parsed.data;

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: SseEvent): void => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };
      try {
        await executeRagChat(send, dialogChatId, text, {
          strategy,
          k,
          llm,
          chatKey,
          topicId,
          noRag,
          signal: req.signal,
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

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { dialogChatId } = await ctx.params;
  const parsed = ragChatPatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  const { title, task, taskClear } = parsed.data;
  const data = await withDb(() => {
    const dialog = getDialogDb();
    const chat = dialog.getChat(dialogChatId);
    if (!chat) return null;
    if (typeof title === 'string' && title.length > 0) {
      dialog.renameChat(dialogChatId, title);
    }
    if (taskClear) {
      dialog.clearTaskState(dialogChatId);
    } else if (typeof task === 'string' && task.length > 0) {
      // /task <desc>: задаём goal, сохраняя прочие секции (terms/constraints/clarifications).
      const prev = dialog.loadTaskState(dialogChatId);
      dialog.upsertTaskState(dialogChatId, withGoal(prev, task));
    }
    const updated = dialog.getChat(dialogChatId);
    const taskState = dialog.loadTaskState(dialogChatId);
    return { chat: updated, taskStateText: renderTaskStateForUi(taskState) };
  });
  if (!data) return Response.json({ error: 'Чат не найден' }, { status: 404 });
  return Response.json(data);
}
