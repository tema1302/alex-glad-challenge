import { AIConfig, getApiUrl, getModel, getHeaders } from './zai';
import { logger } from './logger';

export type ResearchStrategy = 'direct' | 'step_by_step' | 'meta_prompt' | 'expert_panel';

export interface ResearchResult {
  strategy: ResearchStrategy;
  label: string;
  content: string;
  timestamp: number;
}

const BASE_TASK = `Проведи глубокое исследование текста Telegram-канала.
Проанализируй:
1. Как автор общается с аудиторией — тон, стиль, приёмы коммуникации
2. Какие ключевые тезисы и идеи доносятся до читателей
3. Что именно пишет автор — тематика, формат постов, частота, структура
4. В чём заключается успешность этого канала — факторы роста, вовлечённости, лояльности
5. Сильные и слабые стороны контент-стратегии
6. Рекомендации для replication (повторения) успеха для футбольного канала Иди на факты глянь про тактику, трансферы, обзоры Челси`;

const STRATEGY_PROMPTS: Record<ResearchStrategy, { label: string; system: string; user: string }> = {
  direct: {
    label: 'Прямой ответ',
    system: 'Ты — опытный аналитик социальных медиа и контент-стратег.',
    user: BASE_TASK,
  },
  step_by_step: {
    label: 'Пошагово',
    system: 'Ты — опытный аналитик социальных медиа и контент-стратег. Решай задачу пошагово: разбей анализ на последовательные этапы, на каждом этапе делай вывод, а в конце подведи итог.',
    user: `${BASE_TASK}\n\nРешай пошагово: каждый шаг — отдельный аспект анализа с выводом.`,
  },
  meta_prompt: {
    label: 'Мета-промпт',
    system: `Ты — эксперт по созданию промптов для ИИ. Твоя задача: сначала составить оптимальный промпт для анализа Telegram-канала, а затем использовать его для полного исследования.

Структура ответа:
## Составленный промпт
(здесь выведи промпт, который ты составил)

## Результат анализа по промпту
(здесь выполни анализ, используя составленный промпт)`,
    user: `Сначала составь лучший промпт для анализа Telegram-канала, затем примени его к тексту ниже.\n\n${BASE_TASK}`,
  },
  expert_panel: {
    label: 'Группа экспертов',
    system: `Ты — панель из 4 экспертов. Каждый эксперт анализирует текст независимо со своей точки зрения:

👨‍💼 **Аналитик контента** — фокус на структуре, тематике, форматах постов, информационной плотности
📊 **Маркетолог** — фокус на вовлечённости, росте аудитории, воронке, call-to-action, монетизации
🧠 **Психолог коммуникации** — фокус на тональности, эмоциональных триггерах, техниках убеждения, связи с аудиторией
✍️ **Копирайтер-стратег** — фокус на стиле текста, заголовках, структуре повествования, читаемости, уникальности voice

Для каждого эксперта выведи отдельный блок с его анализом. В конце — сводная таблица ключевых инсайтов.`,
    user: BASE_TASK,
  },
};

async function callResearchAI(config: AIConfig, systemPrompt: string, userPrompt: string, sourceText: string): Promise<string> {
  const url = config.provider === 'custom' ? (config.apiUrl || '') : getApiUrl(config.provider);
  const model = getModel(config);

  if (!url) throw new Error('API URL не настроен');
  if (!config.apiKey) throw new Error('API ключ не указан');

  const fullUserMessage = `${userPrompt}\n\n---\n\nТЕКСТ ДЛЯ АНАЛИЗА:\n${sourceText}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(config),
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: fullUserMessage },
      ],
      temperature: 0.7,
      max_tokens: 16384,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`API Error ${response.status}: ${errText || response.statusText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Пустой ответ от API');

  return content.trim();
}

export async function runResearch(
  strategy: ResearchStrategy,
  sourceText: string,
  config: AIConfig,
): Promise<ResearchResult> {
  const { label, system, user } = STRATEGY_PROMPTS[strategy];

  logger.info(`Starting research: ${label}`);

  const content = await callResearchAI(config, system, user, sourceText);

  return {
    strategy,
    label,
    content,
    timestamp: Date.now(),
  };
}

export const STRATEGY_LIST: { key: ResearchStrategy; label: string; description: string; icon: string }[] = [
  { key: 'direct', label: 'Прямой ответ', description: 'Без дополнительных инструкций', icon: '⚡' },
  { key: 'step_by_step', label: 'Пошагово', description: 'Решай пошагово с выводами', icon: '🔢' },
  { key: 'meta_prompt', label: 'Мета-промпт', description: 'Сначала промпт, потом анализ', icon: '🪄' },
  { key: 'expert_panel', label: 'Эксперты', description: '4 роли: аналитик, маркетолог, психолог, копирайтер', icon: '👥' },
];
