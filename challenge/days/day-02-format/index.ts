// День 2. Формат ответа.
// Сравниваем три режима: без ограничений, жёсткий JSON, stop-sequence + max_tokens.

import { type ChatParams, LlmClient, msg } from '@challenge/core';

const PROMPT = 'Дай три совета, как писать понятные промпты для LLM.';

async function main(): Promise<void> {
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
