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
//
// Запуск: pnpm --filter day-01-first-request start
//      или: pnpm exec tsx challenge/days/day-01-first-request/index.ts
// ============================================================================

import { LlmClient, msg } from '@challenge/core';

async function main(): Promise<void> {
  const client = new LlmClient();
  console.log(`Использую модель: ${client.defaultModel}`);

  const answer = await client.chat([msg.user('Объясни одной фразой, что такое токен в LLM.')]);
  console.log('Ответ модели:\n' + answer);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
