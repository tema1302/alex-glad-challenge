// ============================================================================
// День 5. Версии моделей
// ============================================================================
// ЗАДАНИЕ:
//   Выполните один и тот же запрос на слабой / средней / сильной модели.
//   Замерьте время ответа, количество токенов, стоимость.
//   Сравните качество, скорость, ресурсоёмкость.

import { type ChatParams, LlmClient, msg } from '../core/index.js';
import type { Demo } from './types.js';

const PROMPT = 'Объясни одной фразой, зачем нужен self-attention в трансформерах.';

interface Tier {
  label: string;
  model: string;
}

function pickTiers(defaultModel: string): Tier[] {
  // Если дефолт от OpenRouter — сравниваем 3 разных семейства.
  // Иначе (DeepSeek) — chat/reasoner/default.
  if (defaultModel.includes('/')) {
    return [
      { label: 'weak', model: 'openai/gpt-4o-mini' },
      { label: 'medium', model: 'google/gemini-2.0-flash-001' },
      { label: 'strong', model: 'anthropic/claude-3.5-sonnet' },
    ];
  }
  return [
    { label: 'chat', model: 'deepseek-chat' },
    { label: 'reasoner', model: 'deepseek-reasoner' },
    { label: 'default', model: defaultModel },
  ];
}

async function run(): Promise<void> {
  const client = new LlmClient();
  const tiers = pickTiers(client.defaultModel);

  for (const { label, model } of tiers) {
    console.log(`=== ${label}: ${model} ===`);
    const t0 = Date.now();
    const params: ChatParams = { model, temperature: 0 };
    try {
      const { content, usage } = await client.chatWithUsage([msg.user(PROMPT)], params);
      const dt = Date.now() - t0;
      console.log(`Время: ${(dt / 1000).toFixed(2)}s`);
      console.log(
        `Токены: prompt=${usage.prompt_tokens} completion=${usage.completion_tokens} total=${usage.total_tokens}`,
      );
      console.log('Ответ: ' + content + '\n');
    } catch (err) {
      console.log(`Ошибка на модели ${model}: ${(err as Error).message}\n`);
    }
  }
}

export const demo: Demo = {
  id: 'day-05',
  title: 'Версии моделей',
  run,
};
