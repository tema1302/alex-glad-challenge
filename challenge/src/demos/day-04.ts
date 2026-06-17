// ============================================================================
// День 4. Температура
// ============================================================================
// ЗАДАНИЕ:
//   Выполните один и тот же запрос с temperature = 0, 0.7, 1.2.
//   Сравните ответы по точности, креативности, разнообразию.
//   Сформулируйте, для каких задач лучше подходит каждая настройка.

import { type ChatParams, LlmClient, msg } from '../core/index.js';
import type { Demo } from './types.js';

const PROMPT = 'Напиши короткий слоган для кофе-шопа, где варят только альтернативу.';

async function run(): Promise<void> {
  const client = new LlmClient();

  for (const temp of [0, 0.7, 1.2]) {
    const params: ChatParams = { temperature: temp };
    console.log(`=== temperature = ${temp} ===`);
    const out = await client.chat([msg.user(PROMPT)], params);
    console.log(out + '\n');
  }
}

export const demo: Demo = {
  id: 'day-04',
  title: 'Температура',
  run,
};
