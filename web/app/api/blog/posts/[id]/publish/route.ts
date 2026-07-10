// /api/blog/posts/[id]/publish — публикация поста в Telegram-канал (день 28, web P4a).
// POST → реальная отправка (Bot API). Гейт: вызов publishPost ТОЛЬКО при isTelegramConfigured().
// error → safeMessage (без TG_BOT_TOKEN; токен в URL path — redact https?:// → <url>).
// server-only: core/ (publishPost/isTelegramConfigured) через chokepoint.
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { getBlogDb, withDb } from '../../../../../../lib/server/db';
import { publishPost, isTelegramConfigured } from '../../../../../../lib/server/challenge';
import { safeMessage } from '../../../../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 });
  }

  // Гейт: публикуем только если TG настроен (TG_BOT_TOKEN + TG_CHAT_ID в .env).
  if (!isTelegramConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'Telegram не настроен (TG_BOT_TOKEN/TG_CHAT_ID не заданы)' },
      { status: 400 },
    );
  }

  const post = await withDb(() => getBlogDb().getPost(id));
  if (!post) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const result = await publishPost(post.content);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: safeMessage(result.error ?? 'publish failed') },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, messageId: result.messageId });
}
