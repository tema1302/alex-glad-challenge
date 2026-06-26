// Загрузка и парсинг RSS-лент футбольных источников.
// Возвращает плоский массив свежих новостей (за последние N часов).

import { XMLParser } from 'fast-xml-parser';

import type { NewsRow } from '../db.js';

export interface RssItem {
  title: string;
  link: string;
  pubDate: string;       // как в ленте, парсится в Date
  contentSnippet: string;
  source: string;
}

const FEEDS: Array<{ source: string; url: string }> = [
  // Championat.com — футбол (Россия)
  { source: 'championat.com', url: 'https://www.championat.com/rss/news/football/' },
  // Sky Sports — football news (Англия)
  { source: 'skysports.com', url: 'https://www.skysports.com/rss/11095' },
  // Sky Sports — Premier League
  { source: 'skysports.com (EPL)', url: 'https://www.skysports.com/rss/12040' },
];

// Нормализовать нестандартные сокращения часовых поясов (BST, EST, ...)
// в числовое смещение, чтобы Date.parse понимал.
function normalizeTz(s: string): string {
  const tzMap: Record<string, string> = {
    BST: '+01:00',  // British Summer Time
    GMT: '+00:00',
    EST: '-05:00',
    EDT: '-04:00',
    PST: '-08:00',
    PDT: '-07:00',
    CET: '+01:00',
    CEST: '+02:00',
    MSK: '+03:00',
  };
  return s.replace(/([A-Z]{2,5})\s*$/, (match, tz) => tzMap[tz] ?? match);
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

function snippetFrom(item: Record<string, unknown>): string {
  const raw =
    (item['description'] as string) ??
    (item['content:encoded'] as string) ??
    (item['summary'] as string) ??
    '';
  // Выкинуть HTML-теги, ужать до 400 символов.
  const text = String(raw).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return text.length > 400 ? text.slice(0, 397) + '...' : text;
}

async function fetchFeed(feed: { source: string; url: string }): Promise<RssItem[]> {
  try {
    const resp = await fetch(feed.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; llm-challenge-bot/0.1)' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      console.error(`[rss] ${feed.source}: HTTP ${resp.status}`);
      return [];
    }
    const xml = await resp.text();
    const parsed = xmlParser.parse(xml) as {
      rss?: { channel?: { item?: Record<string, unknown>[] } };
      feed?: { entry?: Record<string, unknown>[] };
    };

    const items =
      parsed.rss?.channel?.item ?? parsed.feed?.entry ?? [];
    return items.map((it) => ({
      title: String(it['title'] ?? '').trim(),
      link: String(it['link'] ?? it['@_link'] ?? '').trim(),
      pubDate: String(it['pubDate'] ?? it['published'] ?? it['updated'] ?? '').trim(),
      contentSnippet: snippetFrom(it),
      source: feed.source,
    }));
  } catch (err) {
    console.error(`[rss] ${feed.source}: ${(err as Error).message}`);
    return [];
  }
}

export async function fetchAllFeeds(): Promise<RssItem[]> {
  const results = await Promise.all(FEEDS.map(fetchFeed));
  return results.flat();
}

// Отфильтровать по давности (по умолчанию — последние 24 часа).
export function filterRecent(items: RssItem[], maxAgeHours = 24): RssItem[] {
  const cutoff = Date.now() - maxAgeHours * 3600_000;
  return items
    .filter((it) => {
      const t = Date.parse(normalizeTz(it.pubDate));
      return Number.isFinite(t) && t >= cutoff;
    })
    .sort((a, b) => Date.parse(normalizeTz(b.pubDate)) - Date.parse(normalizeTz(a.pubDate)));
}

// Конвертация RssItem в формат строки БД.
export function toNewsRow(item: RssItem): Omit<NewsRow, 'id' | 'used' | 'created_at'> {
  const published = new Date(Date.parse(normalizeTz(item.pubDate))).toISOString();
  return {
    url: item.link,
    title: item.title,
    summary: item.contentSnippet,
    published_at: published,
    source: item.source,
  };
}
