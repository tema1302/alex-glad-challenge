// /api/tg/top — топ-сообщения TG-топика (read-only). web P3a.
// GET ?chatKey=...&topicId=...&limit=...&by=reactions|date → { messages, count }.
// Только SELECT через TgStore (topByReactions/topByDate/countInTopic). tg.sqlite НЕ мутируется.
// topicId по умолчанию 1 (форум-топик General), если не задан — соглашение forum-топиков.
import 'server-only';
import { NextRequest } from 'next/server';
import { tgTopSchema } from '../../../../lib/shared/forms';
import { getTgStore, withDb } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const url = req.nextUrl;
  const parsed = tgTopSchema.safeParse({
    chatKey: url.searchParams.get('chatKey') ?? undefined,
    topicId: url.searchParams.get('topicId') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    by: url.searchParams.get('by') ?? undefined,
  });
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  const { chatKey, limit = 20, by = 'reactions' } = parsed.data;
  const topicId = parsed.data.topicId ?? 1;

  const result = await withDb(() => {
    const tg = getTgStore();
    const messages = by === 'date'
      ? tg.topByDate(chatKey, topicId, limit)
      : tg.topByReactions(chatKey, topicId, limit);
    const count = tg.countInTopic(chatKey, topicId);
    return { messages, count };
  });

  // Плоская проекция: reactions_json → объект (для UI). text snippet обрезаем в UI.
  const messages = result.messages.map((m) => ({
    msg_id: m.msg_id,
    from_name: m.from_name,
    text: m.text,
    date_iso: m.date_iso,
    reaction_total: m.reaction_total,
    reactions: safeParseReactions(m.reactions_json),
  }));
  return Response.json({ messages, count: result.count, chatKey, topicId, by });
}

function safeParseReactions(json: string): Record<string, number> {
  try {
    const v = JSON.parse(json) as unknown;
    if (v && typeof v === 'object') return v as Record<string, number>;
  } catch {
    // битый json — пустой объект
  }
  return {};
}
