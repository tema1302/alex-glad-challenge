// Агент 1: RSS NewsFetcher.
// Парсит RSS-ленты, отдаёт последние новости.
// Адаптирован под интерфейс SourceAgent для параллельной работы.

import { fetchAllFeedsDetailed, filterRecent, toNewsRow } from './rss.js';
import type { BlogDb } from '../db.js';
import type { SourceAgent, SourceAgentResult, TrendingTopic } from './sourceAgent.js';

export class RssSourceAgent implements SourceAgent {
  readonly name = 'rss';

  constructor(
    private db: BlogDb,
    private maxAgeHours: number = 24,
    private limit: number = 10,
  ) {}

  async fetch(): Promise<SourceAgentResult> {
    try {
      const { items: fresh, errors } = await fetchAllFeedsDetailed();
      const items = filterRecent(fresh, this.maxAgeHours);
      let added = 0;
      for (const item of items) {
        if (this.db.insertNews(toNewsRow(item))) added++;
      }

      const unused = this.db.unusedNewsSince(
        new Date(Date.now() - this.maxAgeHours * 3600_000).toISOString(),
      );

      const topics: TrendingTopic[] = unused.slice(0, this.limit).map((news) => ({
        title: news.title,
        description: news.summary.slice(0, 200),
        source: news.source,
        url: news.url,
        hypeScore: 0,
        hypeReason: '',
        rawContent: news.summary,
      }));

      // Честный отчёт: темы есть, но часть фидов ответила ошибкой — тоже покажем.
      const error =
        topics.length === 0 && errors.length > 0
          ? errors.join('; ')
          : topics.length > 0 && errors.length > 0
            ? `частично: ${errors.join('; ')}`
            : undefined;
      return { agent: this.name, topics, error };
    } catch (err) {
      return { agent: this.name, topics: [], error: (err as Error).message };
    }
  }
}
