// День 4. Температура.
// Один и тот же промпт трижды с temperature = 0, 0.7, 1.2.
// Выводим все три, чтобы визуально сравнить точность/креатив/разнообразие.

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
