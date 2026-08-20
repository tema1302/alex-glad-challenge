// Route Handler: /api/telegram/publish — отправка текста в TG-канал (Bot API, день 28, web P3b).
// POST → реальная отправка. Гейт: publishPost ТОЛЬКО при isTelegramConfigured().
// Реальный внешний эффект — UI требует confirm. error → safeMessage (без TG_BOT_TOKEN;
// токен в URL path — redact https?:// → <url> в safeMessage). server-only.
import 'server-only';
import { NextRequest } from 'next/server';

import { tgPublishSchema } from '../../../../lib/shared/forms';
import { publishPost, isTelegramConfigured } from '../../../../lib/server/challenge';
import { safeMessage } from '../../../../lib/server/safe-message';
import { requireAuth } from '../../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  // Второй auth-слой (день 36): реальный внешний эффект — ошибка в middleware-matcher
  // не должна открывать отправку в TG-канал.
  const denied = requireAuth(req);
  if (denied) return denied;

  const parsed = tgPublishSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }

  // Гейт: публикуем только если TG-бот настроен (TG_BOT_TOKEN + TG_CHAT_ID в .env).
  if (!isTelegramConfigured()) {
    return Response.json(
      { ok: false, error: 'Telegram не настроен (TG_BOT_TOKEN/TG_CHAT_ID не заданы)' },
      { status: 400 },
    );
  }

  const result = await publishPost(parsed.data.text);
  if (!result.ok) {
    return Response.json(
      { ok: false, error: safeMessage(result.error ?? 'publish failed') },
      { status: 502 },
    );
  }
  return Response.json({ ok: true, messageId: result.messageId });
}
