// Общий интерфейс для агентов-источников (этап 1).
// Каждый агент работает параллельно, видит только свой источник,
// возвращает свой топ-тем. Оркестратор собирает все результаты.

export interface TrendingTopic {
  title: string;           // заголовок темы/новости
  description: string;     // краткое описание (1-2 предложения)
  source: string;          // откуда (rss, reddit, sportsru, telegram)
  url?: string;            // ссылка если есть
  hypeScore: number;       // оценка "накала" (0-100)
  hypeReason: string;      // почему эта тема горячая
  rawContent?: string;     // сырой текст для фактчекинга
}

export interface SourceAgentResult {
  agent: string;
  topics: TrendingTopic[];
  error?: string;
}

export interface SourceAgent {
  readonly name: string;
  fetch(): Promise<SourceAgentResult>;
}
