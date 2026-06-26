// ============================================================================
// День 1. Первый запрос к LLM через API
// ============================================================================
// ЗАДАНИЕ:
//   Напишите минимальный код, который:
//   - отправляет запрос в LLM через API
//   - получает ответ
//   - выводит его в консоль или простой интерфейс (CLI / Web)
//
// РЕЗУЛЬТАТ: код, который отправляет запрос в LLM через API и получает ответ.
// ФОРМАТ: видео + код.

import { LlmClient, msg } from '../core/index.js';
import type { Demo } from './types.js';

async function run(): Promise<void> {
  const client = new LlmClient();
  console.log(`Использую модель: ${client.defaultModel}`);

  const answer = await client.chat([msg.user('Объясни одной фразой, что такое токен в LLM.')]);
  console.log('Ответ модели:\n' + answer);
}

export const demo: Demo = {
  id: 'day-01',
  title: 'Первый запрос к LLM через API',
  run,
};
