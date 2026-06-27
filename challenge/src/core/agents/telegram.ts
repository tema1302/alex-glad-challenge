// Публикация постов в Telegram-канал.
// Использует Telegram Bot API через fetch.
// Токен и chat_id берутся из .env: TG_BOT_TOKEN, TG_CHAT_ID.
// Прокси:
//   TELEGRAM_PROXY=socks5h://user:pass@host:port — socks5 через TLS-туннель
//   HTTPS_PROXY=... — HTTP/HTTPS прокси через undici ProxyAgent

import { ProxyAgent } from 'undici';
import { SocksClient } from 'socks';
import * as tls from 'node:tls';

export interface PublishResult {
  ok: boolean;
  messageId?: number;
  error?: string;
}

export function isTelegramConfigured(): boolean {
  return Boolean(process.env['TG_BOT_TOKEN'] && process.env['TG_CHAT_ID']);
}

function parseSocksUrl(url: string): { host: string; port: number; userId?: string; password?: string } | null {
  const m = url.match(/^socks5h?:\/\/([^:]+):([^@]+)@([^:]+):(\d+)$/);
  if (!m) return null;
  return { userId: m[1], password: m[2], host: m[3], port: Number(m[4]) };
}

type FetchOpts = { method: string; headers: Record<string, string>; body: string; timeout: number };

/** HTTP-запрос через socks5h прокси (connect → TLS → raw HTTP). */
async function socksFetch(url: string, opts: FetchOpts): Promise<string> {
  const proxyUrl = process.env['TELEGRAM_PROXY']!;
  const proxy = parseSocksUrl(proxyUrl);
  if (!proxy) throw new Error(`Invalid TELEGRAM_PROXY: ${proxyUrl}`);

  const dest = new URL(url);
  const destHost = dest.hostname;
  const destPort = dest.port ? Number(dest.port) : (dest.protocol === 'https:' ? 443 : 80);

  const { socket } = await SocksClient.createConnection({
    proxy: { host: proxy.host, port: proxy.port, userId: proxy.userId, password: proxy.password, type: 5 },
    command: 'connect',
    destination: { host: destHost, port: destPort },
  });

  let netSocket: tls.TLSSocket;
  if (dest.protocol === 'https:') {
    netSocket = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const s = tls.connect({ socket, servername: destHost }, () => resolve(s));
      s.on('error', reject);
    });
  } else {
    netSocket = socket as unknown as tls.TLSSocket;
  }

  const headersFlat = Object.entries(opts.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n');
  const req = [
    `${opts.method} ${dest.pathname + dest.search} HTTP/1.1`,
    headersFlat,
    opts.body ? `Content-Length: ${Buffer.byteLength(opts.body)}` : '',
    '',
    opts.body || '',
  ].filter(Boolean).join('\r\n') + '\r\n';

  netSocket.write(req);

  return new Promise<string>((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => { netSocket.destroy(); reject(new Error('timeout')); }, opts.timeout);

    netSocket.on('data', (chunk: Buffer) => { buf += chunk.toString(); });
    netSocket.on('end', () => {
      clearTimeout(timer);
      const idx = buf.indexOf('\r\n\r\n');
      resolve(idx >= 0 ? buf.substring(idx + 4) : buf);
    });
    netSocket.on('error', (e: Error) => { clearTimeout(timer); reject(e); });
  });
}

/** Универсальный fetch: пробует TELEGRAM_PROXY → HTTPS_PROXY → прямой. */
async function tgFetch(url: string, opts: FetchOpts): Promise<string> {
  // TELEGRAM_PROXY (socks5h) — приоритет
  if (process.env['TELEGRAM_PROXY']) {
    return socksFetch(url, opts);
  }

  // HTTPS_PROXY (HTTP прокси через undici)
  const proxy = process.env['HTTPS_PROXY'] || process.env['https_proxy'];
  const fetchOpts: Record<string, unknown> = {
    method: opts.method,
    headers: opts.headers,
    body: opts.body || undefined,
    signal: AbortSignal.timeout(opts.timeout),
  };
  if (proxy) {
    fetchOpts['dispatcher'] = new ProxyAgent(proxy);
  }

  const res = await fetch(url, fetchOpts as RequestInit);
  return res.text();
}

export async function getBotInfo(): Promise<Record<string, unknown> | null> {
  const token = process.env['TG_BOT_TOKEN'];
  if (!token) return null;
  try {
    const text = await tgFetch(`https://api.telegram.org/bot${token}/getMe`, {
      method: 'GET', headers: { 'Host': 'api.telegram.org' }, body: '', timeout: 10_000,
    });
    return JSON.parse(text);
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

  const body = JSON.stringify({
    chat_id: Number(chatId),
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });

  try {
    const respText = await tgFetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Host': 'api.telegram.org' },
      body,
      timeout: 15_000,
    });
    const data = JSON.parse(respText) as Record<string, unknown>;
    if (!data['ok']) {
      return { ok: false, error: String(data['description'] ?? ' неизвестная ошибка Telegram API') };
    }
    const result = data['result'] as Record<string, unknown>;
    return { ok: true, messageId: Number(result['message_id'] ?? 0) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
