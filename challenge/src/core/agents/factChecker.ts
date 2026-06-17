// Агент 3. Фактчекинг.
// Сравнивает написанный пост с исходной новостью, проверяет, что все факты
// (имена, клубы, счёт, даты, цифры) соответствуют источнику. Возвращает список
// расхождений и итоговый verdict: можно публиковать / нужна правка.

import type { NewsRow } from '../db.js';
import { LlmClient, msg } from '../index.js';

export interface FactCheckIssue {
  claim: string;       // что утверждается в посте
  source: string;      // что есть в источнике
  severity: 'low' | 'medium' | 'high';
}

export interface FactCheckResult {
  verdict: 'ok' | 'needs_revision';
  issues: FactCheckIssue[];
  recommendation: string;
}

export class FactChecker {
  constructor(private client: LlmClient) {}

  async check(post: string, news: NewsRow): Promise<FactCheckResult> {
    const prompt = `Ты строгий редактор-фактчекер спортивного Telegram-канала.
Сравни пост с источником. Проверь ВСЕ утверждения про факты:
- имена игроков и тренеров
- названия клубов
- счета матчей и результаты
- даты, возраст, суммы трансферов
- цитаты (если в посте — должны быть в источнике)

=== ИСТОЧНИК (НОВОСТЬ) ===
Заголовок: ${news.title}
Текст: ${news.summary}
Источник: ${news.source}
Дата: ${news.published_at}

=== ПОСТ НА ПРОВЕРКУ ===
${post}

Ответь СТРОГО JSON-объектом вида:
{
  "verdict": "ok" | "needs_revision",
  "issues": [{"claim": "...", "source": "...", "severity": "low|medium|high"}],
  "recommendation": "короткий совет по-русски"
}
issues — пустой массив, если расхождений нет.
verdict = "ok" если нет issues с severity "high" или "medium".
Никакого текста вне JSON.`;

    const raw = await this.client.chat(
      [msg.user(prompt)],
      { temperature: 0.1, maxTokens: 1500 },
    );

    return parseVerdict(raw);
  }
}

function parseVerdict(raw: string): FactCheckResult {
  // Снять markdown-обёртку.
  const cleaned = raw.replace(/^[\s\S]*?```(?:json)?\s*/i, '').replace(/```\s*$/,'').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return {
      verdict: 'needs_revision',
      issues: [],
      recommendation: 'Не удалось распарсить ответ фактчекера: ' + raw.slice(0, 200),
    };
  }
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    const verdict = obj['verdict'] === 'ok' ? 'ok' : 'needs_revision';
    const issuesRaw = Array.isArray(obj['issues']) ? (obj['issues'] as unknown[]) : [];
    const issues: FactCheckIssue[] = issuesRaw
      .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
      .map((x) => ({
        claim: String(x['claim'] ?? ''),
        source: String(x['source'] ?? ''),
        severity: x['severity'] === 'low' || x['severity'] === 'medium' || x['severity'] === 'high'
          ? (x['severity'] as FactCheckIssue['severity'])
          : 'medium',
      }));
    const recommendation = String(obj['recommendation'] ?? '');
    return { verdict, issues, recommendation };
  } catch {
    return {
      verdict: 'needs_revision',
      issues: [],
      recommendation: 'JSON-ошибка при парсинге ответа фактчекера.',
    };
  }
}
