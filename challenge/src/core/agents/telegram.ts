// Публикация постов в Telegram-канал.
// Использует Telegram Bot API через fetch.
// Токен и chat_id берутся из .env: TG_BOT_TOKEN, TG_CHAT_ID.
// Прокси через HTTPS_PROXY (HTTP/HTTPS прокси, например gost → socks5).

import { ProxyAgent } from 'undici';

export interface PublishResult {
  ok: boolean;
  messageId?: number;
  error?: string;
}

export function isTelegramConfigured(): boolean {
  return Boolean(process.env['TG_BOT_TOKEN'] && process.env['TG_CHAT_ID']);
}

export async function getBotInfo(): Promise<Record<string, unknown> | null> {
  const token = process.env['TG_BOT_TOKEN'];
  if (!token) return null;
  try {
    const proxy = process.env['HTTPS_PROXY'] || process.env['https_proxy'];
    const opts: Record<string, unknown> = { signal: AbortSignal.timeout(10_000) };
    if (proxy) opts['dispatcher'] = new ProxyAgent(proxy);
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, opts as RequestInit);
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

  const proxy = process.env['HTTPS_PROXY'] || process.env['https_proxy'];

  try {
    const fetchOptions: Record<string, unknown> = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(15_000),
    };
    if (proxy) fetchOptions['dispatcher'] = new ProxyAgent(proxy);

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
