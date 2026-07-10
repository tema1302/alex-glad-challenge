// /api/rag/chats — каталог TG-чатов (chatKey→title) + aliases + DialogDb-чаты. web P3a.
// GET  → { titles, aliases: [{name, chatKey, topicId?}], chats: DialogChatItem[] }.
// POST → alias add/rm: { action:'add'|'rm', name, chatKey?, topicId? }.
// Все операции offline (chatCatalog JSON-кэш + DialogDb), БЕЗ MTProto. read-only над
// chat-titles.json; aliases и dialog-chats — собственные файлы/БД (не TG).
import 'server-only';
import { NextRequest } from 'next/server';
import { aliasActionSchema } from '../../../../lib/shared/forms';
import {
  loadChatTitles,
  loadAliases,
  addAlias,
  removeAlias,
} from '../../../../lib/server/challenge';
import { getDialogDb, withDb } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const titles = loadChatTitles();
  const aliasMap = loadAliases();
  const aliases = Object.entries(aliasMap).map(([name, a]) => ({
    name,
    chatKey: a.chatKey,
    ...(a.topicId != null ? { topicId: a.topicId } : {}),
  }));
  const chats = await withDb(() => getDialogDb().listChats(100));
  return Response.json({ titles, aliases, chats });
}

export async function POST(req: NextRequest): Promise<Response> {
  const parsed = aliasActionSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  const { action, name, chatKey, topicId } = parsed.data;
  if (action === 'add') {
    if (!chatKey || chatKey.trim().length === 0) {
      return Response.json({ error: 'chatKey обязателен для add' }, { status: 400 });
    }
    const topic = typeof topicId === 'number' ? topicId : undefined;
    addAlias(name, chatKey.trim(), topic);
    return Response.json({ ok: true, name, chatKey: chatKey.trim(), ...(topic != null ? { topicId: topic } : {}) });
  }
  // rm
  const removed = removeAlias(name);
  if (!removed) {
    return Response.json({ error: `alias «${name}» не найден` }, { status: 404 });
  }
  return Response.json({ ok: true, name });
}
