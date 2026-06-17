// ============================================================================
// День 6. Первый агент
// ============================================================================
// ЗАДАНИЕ:
//   Реализуйте простого агента: принимает запрос, отправляет в LLM, возвращает
//   ответ. Агент — отдельная сущность, логика инкапсулирована.
//
// РЕЗУЛЬТАТ: агент принимает запрос и корректно вызывает LLM через API.
//
// Примечание: интерактивный REPL убран ради воспроизводимости в CLI. Для REPL
// используйте флаг --interactive (см. кли). Сейчас демо прогоняет 3 хода.

import { Agent, LlmClient } from '../core/index.js';
import type { Demo } from './types.js';

async function run(): Promise<void> {
  const client = new LlmClient();
  const agent = new Agent(
    client,
    'Ты — короткий ассистент. Отвечай не больше чем в 2 предложения.',
  );

  const turns = [
    'Привет, что ты умеешь?',
    'А сколько будет 2+2?',
    'Покажи пример hello world на TypeScript.',
  ];

  for (const t of turns) {
    console.log(`User: ${t}`);
    const answer = await agent.say(t);
    console.log(`Agent: ${answer}\n`);
  }
}

export const demo: Demo = {
  id: 'day-06',
  title: 'Первый агент',
  run,
};
