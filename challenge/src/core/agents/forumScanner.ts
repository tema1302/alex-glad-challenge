// Агент 2: ForumScanner.
// Парсит Reddit r/soccer (через .json) и Sports.ru (топ по комментариям).
// Каждый источник — отдельный запрос, ошибки не валит весь агент.

import type { SourceAgent, SourceAgentResult, TrendingTopic } from './sourceAgent.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 football-bot/1.0';

export class ForumScannerAgent implements SourceAgent {
  readonly name = 'forum';

  constructor(private limit: number = 10) {}

  async fetch(): Promise<SourceAgentResult> {
    const [reddit, sportsru] = await Promise.allSettled([
      this.fetchReddit(),
      this.fetchSportsRu(),
    ]);

    const topics: TrendingTopic[] = [];

    if (reddit.status === 'fulfilled') topics.push(...reddit.value);
    if (sportsru.status === 'fulfilled') topics.push(...sportsru.value);

    const errors: string[] = [];
    if (reddit.status === 'rejected') errors.push(`reddit: ${reddit.reason}`);
    if (sportsru.status === 'rejected') errors.push(`sports.ru: ${sportsru.reason}`);

    return {
      agent: this.name,
      topics: topics.slice(0, this.limit),
      error: errors.length > 0 ? errors.join('; ') : undefined,
    };
  }

  // Reddit r/soccer — горячие посты через JSON API.
  private async fetchReddit(): Promise<TrendingTopic[]> {
    const url = 'https://www.reddit.com/r/soccer/hot.json?limit=15';
    const resp = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) throw new Error(`reddit HTTP ${resp.status}`);

    const data = await resp.json() as {
      data?: {
        children?: Array<{
          data: {
            title: string;
            score: number;
            num_comments: number;
            url: string;
            selftext?: string;
            link_flair_text?: string;
          };
        }>;
      };
    };

    const children = data.data?.children ?? [];
    return children
      .filter((c) => {
        const flair = c.data.link_flair_text ?? '';
        // Пропускаем match-threads и meta.
        return !flair.toLowerCase().includes('match thread') &&
               !flair.toLowerCase().includes('meta');
      })
      .slice(0, 8)
      .map((c) => ({
        title: c.data.title,
        description: c.data.selftext?.slice(0, 200) ?? '',
        source: 'reddit',
        url: c.data.url,
        hypeScore: Math.min(100, Math.round(c.data.score / 10)),
        hypeReason: `${c.data.score} upvotes, ${c.data.num_comments} comments`,
        rawContent: c.data.selftext ?? c.data.title,
      }));
  }

  // Sports.ru — топ новостей по футболу.
  // RSS умер, парсим главную футбола через HTML.
  private async fetchSportsRu(): Promise<TrendingTopic[]> {
    const url = 'https://www.sports.ru/football/';
    const resp = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) throw new Error(`sports.ru HTTP ${resp.status}`);

    const html = await resp.text();
    const topics: TrendingTopic[] = [];

    // Извлекаем заголовки новостей из HTML.
    // Sports.ru использует классы типа "news-item" или виджеты.
    // Простая эвристика: ищем <a> с title="" внутри блоков новостей.
    const matches = html.matchAll(/<a[^>]*href="(https:\/\/www\.sports\.ru\/football\/[^"]*\.shtml)"[^>]*title="([^"]+)"[^>]*>/gi);
    const seen = new Set<string>();
    for (const m of matches) {
      const link = m[1];
      const title = m[2].trim();
      if (title.length < 10 || seen.has(title)) continue;
      seen.add(title);
      topics.push({
        title,
        description: '',
        source: 'sports.ru',
        url: link,
        hypeScore: 0,
        hypeReason: '',
        rawContent: title,
      });
      if (topics.length >= 8) break;
    }

    return topics;
  }
}
