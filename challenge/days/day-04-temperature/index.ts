// ============================================================================
// День 4. Температура
// ============================================================================
// ЗАДАНИЕ:
//   Выполните один и тот же запрос с параметрами:
//   - temperature = 0
//   - temperature = 0.7
//   - temperature = 1.2
//
//   Сравните ответы по: точности, креативности, разнообразию.
//   Сформулируйте: для каких задач лучше подходит каждая настройка.
//
// РЕЗУЛЬТАТ: примеры ответов с разной температурой и выводы по их использованию.
// ФОРМАТ: видео + код.
// ============================================================================

import { type ChatParams, LlmClient, msg } from '@challenge/core';

const PROMPT = 'Напиши короткий слоган для кофе-шопа, где варят только альтернативу.';

async function main(): Promise<void> {
  const client = new LlmClient();

  for (const temp of [0, 0.7, 1.2]) {
    const params: ChatParams = { temperature: temp };
    console.log(`=== temperature = ${temp} ===`);
    const out = await client.chat([msg.user(PROMPT)], params);
    console.log(out + '\n');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
