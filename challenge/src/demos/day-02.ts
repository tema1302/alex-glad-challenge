// ============================================================================
// День 2. Формат ответа
// ============================================================================
// ЗАДАНИЕ:
//   Отправьте один и тот же запрос, но:
//   - добавьте явное описание формата ответа
//   - добавьте ограничение на длину ответа
//   - добавьте условие завершения ответа (stop sequence или явную инструкцию)
//
//   Сравните ответы: без ограничений vs с ограничениями.
//
// РЕЗУЛЬТАТ: один и тот же запрос с разным уровнем контроля ответа через API.

import { type ChatParams, LlmClient, msg } from '../core/index.js';
import type { Demo } from './types.js';

const PROMPT = 'Дай три совета, как писать понятные промпты для LLM.';

async function run(): Promise<void> {
  const client = new LlmClient();

  console.log('=== Без ограничений ===');
  const a = await client.chat([msg.user(PROMPT)]);
  console.log(a + '\n');

  console.log('=== JSON-формат ===');
  const jsonPrompt =
    PROMPT +
    '\n\nОтветь строго в формате JSON вида:\n' +
    '{"tips": ["...", "...", "..."]}\n' +
    'Никакого текста вне JSON.';
  const b = await client.chat([msg.user(jsonPrompt)]);
  console.log(b + '\n');

  console.log('=== Stop-sequence + max_tokens=60 ===');
  const stopParams: ChatParams = { maxTokens: 60, stop: ['КОНЕЦ'] };
  const stopPrompt = PROMPT + '\n\nЗаканчивай ответ строкой КОНЕЦ.';
  const c = await client.chat([msg.user(stopPrompt)], stopParams);
  console.log(c);
}

export const demo: Demo = {
  id: 'day-02',
  title: 'Формат ответа',
  run,
};
