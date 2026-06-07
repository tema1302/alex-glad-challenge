import { getHeaders } from './zai';
import { logger } from './logger';

export type ModelTier = 'weak' | 'medium' | 'strong';

export interface ResearchResult {
  key: ModelTier;
  label: string;
  model: string;
  content: string;
  timeMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  timestamp: number;
}

const SYSTEM_PROMPT = `Ты — опытный аналитик Telegram-каналов и контент-стратег. Ты специализируешься на футбольной тематике.`;

const USER_PROMPT = `Проанализируй текст постов Telegram-канала «Иди на факты глянь» ниже.

Сделай два блока:

## БЛОК 1: Анализ канала «Иди на факты глянь»
1. Как автор общается с аудиторией — тон, стиль, приёмы коммуникации
2. Какие ключевые тезисы и идеи доносятся до читателей
3. Что именно пишет автор — тематика, формат постов, частота, структура
4. В чём заключается успешность этого канала — факторы роста, вовлечённости, лояльности
5. Сильные и слабые стороны контент-стратегии

## БЛОК 2: Сравнение с каналом Антонова и рекомендации
1. Сравни стиль «Иди на факты глянь» со стилем Антонова — что общего, чем отличаются
2. Что Антонов делает лучше — конкретные приёмы, форматы, подходы
3. ЧТО КОНКРЕТНО нужно подтянуть автору «Иди на факты глянь» — конкретные шаги, форматы постов, идеи по тактике, трансферам, обзорам Челси
4. Топ-5 конкретных действий, которые нужно внедрить прямо сейчас

Ответ должен быть структурированным, с заголовками, примерами и выводами.`;

export const MODEL_TIERS: {
  key: ModelTier;
  label: string;
  model: string;
  icon: string;
  tier: string;
  pricePerMillion: { input: number; output: number };
}[] = [
  {
    key: 'weak',
    label: 'Слабая',
    model: 'qwen/qwen3-32b',
    icon: '🟢',
    tier: 'Слабая модель (бесплатная, 32B параметров)',
    pricePerMillion: { input: 0, output: 0 },
  },
  {
    key: 'medium',
    label: 'Средняя',
    model: 'deepseek/deepseek-chat-v3-0324',
    icon: '🟡',
    tier: 'Средняя модель ($0.30/1M input, $0.88/1M output)',
    pricePerMillion: { input: 0.30, output: 0.88 },
  },
  {
    key: 'strong',
    label: 'Сильная',
    model: 'google/gemini-2.5-pro-preview',
    icon: '🔴',
    tier: 'Сильная модель ($1.25/1M input, $10/1M output)',
    pricePerMillion: { input: 1.25, output: 10.0 },
  },
];

function calcCost(tier: typeof MODEL_TIERS[number], promptTokens: number, completionTokens: number): number {
  const { input, output } = tier.pricePerMillion;
  return (promptTokens * input + completionTokens * output) / 1_000_000;
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

async function callModel(
  apiKey: string,
  model: string,
  sourceText: string,
): Promise<{ content: string; promptTokens: number; completionTokens: number; totalTokens: number }> {
  const fullUserMessage = `${USER_PROMPT}\n\n---\n\nТЕКСТ ДЛЯ АНАЛИЗА:\n${sourceText}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': window.location.origin,
    'X-Title': 'LMS Research',
  };

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
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

  const usage = data?.usage ?? {};
  return {
    content: content.trim(),
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
  };
}

export async function runResearch(
  key: ModelTier,
  sourceText: string,
  openrouterKey: string,
): Promise<ResearchResult> {
  const tier = MODEL_TIERS.find(t => t.key === key)!;
  logger.info(`Starting research: ${tier.label} (${tier.model})`);

  const start = performance.now();
  const result = await callModel(openrouterKey, tier.model, sourceText);
  const timeMs = Math.round(performance.now() - start);

  return {
    key,
    label: tier.label,
    model: tier.model,
    content: result.content,
    timeMs,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    totalTokens: result.totalTokens,
    costUsd: calcCost(tier, result.promptTokens, result.completionTokens),
    timestamp: Date.now(),
  };
}

export const COMPARISON_DIMENSIONS = [
  { id: 'quality', label: 'Качество ответов', description: 'Глубина анализа, конкретность рекомендаций, структура' },
  { id: 'speed', label: 'Скорость', description: 'Время ответа от API (ms)' },
  { id: 'resources', label: 'Ресурсоёмкость', description: 'Количество токенов и стоимость запроса' },
];
