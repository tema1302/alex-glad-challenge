// «Свежее в канале» на лендинге: парсинг публичной веб-версии Telegram-канала
// (t.me/s/<username>) без Bot API и без внешних зависимостей — только netFetch
// из chokepoint и regex. Разметка t.me/s стабильна годами: каждое сообщение —
// блок с data-post="<канал>/<id>", внутри datetime и tgme_widget_message_text.
// Деликатная деградация обязательна: канал недоступен (сеть/прокси/блокировка)
// → { ok: false }, лендинг просто не рисует секцию. Успехи кэшируются на 10 мин,
// неудачи на 60 с — рендер лендинга не превращается в сетевой шторм.
import 'server-only';
import { netFetch } from './challenge';

export interface ChannelPost {
  id: number;
  url: string;
  dateIso: string;
  text: string;
}

export type ChannelPreview =
  | { ok: true; posts: ChannelPost[] }
  | { ok: false };

const ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
};

/** HTML блока текста → читаемый текст: <br> → перенос, теги долой, энтити → символы. */
export function messageHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#?\w+);/g, (m, name: string) => ENTITIES[name] ?? m)
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Достаёт последние посты из HTML t.me/s/<username>. Посты без текста
 * (фото-без-подписи, сервисные) пропускаются. Результат — новые первыми.
 */
export function parseChannelHtml(html: string, username: string, limit = 4): ChannelPost[] {
  const posts: ChannelPost[] = [];
  const marker = /data-post="([^"]+)"/g;
  const starts: Array<{ id: number; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = marker.exec(html)) !== null) {
    const id = Number.parseInt(m[1].split('/')[1] ?? '', 10);
    if (Number.isFinite(id)) starts.push({ id, index: m.index });
  }
  for (let i = 0; i < starts.length; i++) {
    const block = html.slice(starts[i].index, i + 1 < starts.length ? starts[i + 1].index : undefined);
    const dt = /datetime="([^"]+)"/.exec(block);
    const textMatch = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(block);
    if (!dt || !textMatch) continue;
    const text = messageHtmlToText(textMatch[1]);
    if (text.length === 0) continue;
    posts.push({
      id: starts[i].id,
      url: `https://t.me/${username.replace(/^@/, '')}/${starts[i].id}`,
      dateIso: dt[1],
      text,
    });
  }
  return posts.sort((a, b) => b.id - a.id).slice(0, Math.max(limit, 0));
}

export interface ChannelPreviewDeps {
  /** Скачивает HTML веб-версии канала (по умолчанию — netFetch через chokepoint). */
  fetcher?: (url: string) => Promise<string>;
  now?: () => number;
  okTtlMs?: number;
  failTtlMs?: number;
}

export function createChannelPreview(username: string, deps: ChannelPreviewDeps = {}) {
  const {
    fetcher = async (url: string) => {
      const resp = await netFetch(url, { label: 'телеграм-канал', timeoutMs: 6000 });
      return resp.text();
    },
    now = () => Date.now(),
    okTtlMs = 10 * 60_000,
    failTtlMs = 60_000,
  } = deps;

  let cache: { at: number; posts: ChannelPost[] } | null = null;
  let failedAt: number | null = null;

  return async function getChannelPreview(): Promise<ChannelPreview> {
    const t = now();
    if (cache && t - cache.at < okTtlMs) return { ok: true, posts: cache.posts };
    if (failedAt !== null && t - failedAt < failTtlMs) return { ok: false };
    try {
      const html = await fetcher(`https://t.me/s/${username.replace(/^@/, '')}`);
      const posts = parseChannelHtml(html, username);
      if (posts.length === 0) {
        failedAt = t;
        return { ok: false };
      }
      cache = { at: t, posts };
      failedAt = null;
      return { ok: true, posts };
    } catch {
      failedAt = t;
      return { ok: false };
    }
  };
}

/** Синглтон для лендинга. */
export const getChannelPreview = createChannelPreview('@artemiyartel');
