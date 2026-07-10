// /api/briefing — read-only сводка состояния. web P3a.
// GET ?chatKey&topicId → { todoSummary, stats, topTg? }.
//   todoSummary — getPendingSummary() (строка, готовый блок для сводки).
//   stats — счётчики blog/rag/tg/dialog (как dashboard, плоско).
//   topTg  — топ-5 по реакциям, если задан chatKey (и есть данные). Без publish — P3b.
// Только чтение; ничего не мутируется. БЕЗ отправки в TG.
import 'server-only';
import { NextRequest } from 'next/server';
import { getBlogDb, getDialogDb, getRagStore, getTgStore, getTodoDb, withDb } from '../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const chatKey = req.nextUrl.searchParams.get('chatKey')?.trim() || undefined;
  const topicIdRaw = req.nextUrl.searchParams.get('topicId');
  const topicId = topicIdRaw ? Number(topicIdRaw) : 1;

  const data = await withDb(() => {
    const blog = getBlogDb();
    const rag = getRagStore();
    const tg = getTgStore();
    const dialog = getDialogDb();
    const todo = getTodoDb();

    const todoSummary = todo.getPendingSummary();
    const tgStats = tg.stats();
    const dialogChats = dialog.listChats(2000);
    const topTg = chatKey
      ? tg.topByReactions(chatKey, Number.isFinite(topicId) ? topicId : 1, 5).map((m) => ({
          msg_id: m.msg_id,
          from_name: m.from_name,
          text: m.text,
          date_iso: m.date_iso,
          reaction_total: m.reaction_total,
        }))
      : undefined;

    return {
      todoSummary,
      stats: {
        news: blog.newsCount(),
        posts: blog.postsCount(),
        ragFixed: rag.count('fixed'),
        ragStructure: rag.count('structure'),
        ragTelegram: rag.count('telegram'),
        tgMessages: tgStats.messages,
        tgChats: tgStats.chats,
        tgTopics: tgStats.topics,
        dialogChats: dialogChats.length,
        dialogMessages: dialogChats.reduce((s, c) => s + c.msg_count, 0),
      },
      topTg,
    };
  });

  return Response.json({ ...data, chatKey, topicId: Number.isFinite(topicId) ? topicId : 1 });
}
