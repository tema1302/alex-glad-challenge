// День 1. Первый запрос к LLM через API.
// Минимальный код: создаём клиент, отправляем одно сообщение, печатаем ответ.
//
// Запуск: pnpm --filter day-01-first-request start
//      или: pnpm exec tsx challenge/days/day-01-first-request/index.ts

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
