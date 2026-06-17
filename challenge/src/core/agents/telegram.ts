// Публикация постов в Telegram-канал «Иди на факты глянь».
// Использует Telegram Bot API через fetch (без лишних зависимостей).
// Токен и chat_id берутся из .env: TG_BOT_TOKEN, TG_CHAT_ID.
// Поддержка прокси через HTTPS_PROXY (для сред, где Telegram заблокирован).

import { ProxyAgent } from 'undici';

export interface PublishResult {
  ok: boolean;
  messageId?: number;
  error?: string;
}

export function isTelegramConfigured(): boolean {
  return Boolean(process.env['TG_BOT_TOKEN'] && process.env['TG_CHAT_ID']);
}

function getDispatcher(): ProxyAgent | undefined {
  const proxy = process.env['HTTPS_PROXY'] || process.env['https_proxy'];
  if (!proxy) return undefined;
  return new ProxyAgent(proxy);
}

export async function getBotInfo(): Promise<Record<string, unknown> | null> {
  const token = process.env['TG_BOT_TOKEN'];
  if (!token) return null;
  const url = `https://api.telegram.org/bot${token}/getMe`;
  const dispatcher = getDispatcher();
  const opts: Record<string, unknown> = { signal: AbortSignal.timeout(10_000) };
  if (dispatcher) opts['dispatcher'] = dispatcher;
  try {
    const res = await fetch(url, opts as RequestInit);
    return await res.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function publishPost(text: string): Promise<PublishResult> {
  const token = process.env['TG_BOT_TOKEN'];
  const chatId = process.env['TG_CHAT_ID'];

  if (!token || !chatId) {
    return { ok: false, error: 'TG_BOT_TOKEN или TG_CHAT_ID не заданы в .env' };
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = JSON.stringify({
    chat_id: Number(chatId),
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });

  const dispatcher = getDispatcher();

  try {
    const fetchOptions: Record<string, unknown> = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(15_000),
    };
    if (dispatcher) fetchOptions['dispatcher'] = dispatcher;

    const res = await fetch(url, fetchOptions as RequestInit);
    const data = await res.json() as Record<string, unknown>;
    if (!data['ok']) {
      return { ok: false, error: String(data['description'] ?? ' неизвестная ошибка Telegram API') };
    }
    const result = data['result'] as Record<string, unknown>;
    return { ok: true, messageId: Number(result['message_id'] ?? 0) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
