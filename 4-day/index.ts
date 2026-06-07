import { AIConfig, getApiUrl, getModel, getHeaders } from './zai';
import { logger } from './logger';

export type TempKey = 'temp_0' | 'temp_07' | 'temp_12';

export interface ResearchResult {
  key: TempKey;
  label: string;
  temperature: number;
  content: string;
  timestamp: number;
}

const SYSTEM_PROMPT = `Ты — опытный аналитик Telegram-каналов и контент-стратег.`;

const USER_PROMPT = `Проанализируй текст Telegram-канала ниже и дай развёрнутый ответ.

Что нужно сделать:
1. Как автор общается с аудиторией — тон, стиль, приёмы коммуникации
2. Какие ключевые тезисы и идеи доносятся до читателей
3. Что именно пишет автор — тематика, формат постов, частота, структура
4. В чём заключается успешность этого канала — факторы роста, вовлечённости, лояльности
5. Сильные и слабые стороны контент-стратегии
6. ЧТО КОНКРЕТНО нужно делать в моём канале «Иди на факты глянь» — дай практические рекомендации по тактике, трансферам, обзорам Челси. Конкретные шаги, форматы постов, идеи.

Ответ должен быть структурированным, с заголовками и примерами.`;

export const TEMP_PRESETS: { key: TempKey; label: string; temperature: number; description: string; icon: string }[] = [
  { key: 'temp_0', label: 'Точность', temperature: 0, description: 'temperature = 0 — максимум точности, минимум вариативности', icon: '🎯' },
  { key: 'temp_07', label: 'Баланс', temperature: 0.7, description: 'temperature = 0.7 — баланс точности и креативности', icon: '⚖️' },
  { key: 'temp_12', label: 'Креатив', temperature: 1.2, description: 'temperature = 1.2 — максимум креативности и разнообразия', icon: '🎨' },
];

async function callResearchAI(config: AIConfig, temperature: number, sourceText: string): Promise<string> {
  const url = config.provider === 'custom' ? (config.apiUrl || '') : getApiUrl(config.provider);
  const model = getModel(config);

  if (!url) throw new Error('API URL не настроен');
  if (!config.apiKey) throw new Error('API ключ не указан');

  const fullUserMessage = `${USER_PROMPT}\n\n---\n\nТЕКСТ ДЛЯ АНАЛИЗА:\n${sourceText}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(config),
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: fullUserMessage },
      ],
      temperature,
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
  key: TempKey,
  sourceText: string,
  config: AIConfig,
): Promise<ResearchResult> {
  const preset = TEMP_PRESETS.find(p => p.key === key)!;
  logger.info(`Starting research: ${preset.label} (temp=${preset.temperature})`);

  const content = await callResearchAI(config, preset.temperature, sourceText);

  return {
    key,
    label: preset.label,
    temperature: preset.temperature,
    content,
    timestamp: Date.now(),
  };
}

export const COMPARISON_DIMENSIONS = [
  { id: 'accuracy', label: 'Точность', description: 'Насколько ответ factual, без выдумок и галлюцинаций' },
  { id: 'creativity', label: 'Креативность', description: 'Оригинальность идей, нестандартные подходы, метафоры' },
  { id: 'diversity', label: 'Разнообразие', description: 'Широта охвата тем, разные углы зрения, вариативность рекомендаций' },
];
