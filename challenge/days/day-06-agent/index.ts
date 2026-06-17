// ============================================================================
// День 6. Первый агент
// ============================================================================
// ЗАДАНИЕ:
//   Реализуйте простого агента, который:
//   - принимает запрос пользователя
//   - отправляет его в LLM через API
//   - получает ответ
//   - выводит результат в вашем интерфейсе
//   (простой чат, CLI или web, запросы через HTTP-клиент)
//
//   Важно:
//   - агент должен быть отдельной сущностью, а не просто один вызов API
//   - логика запроса и ответа должна быть инкапсулирована в агенте
//
// РЕЗУЛЬТАТ: агент принимает запрос и корректно вызывает LLM через API.
// ФОРМАТ: видео + код.
// ============================================================================

import { createInterface } from 'node:readline/promises';
import { type ChatMessage, LlmClient, msg } from '@challenge/core';

class Agent {
  private system: ChatMessage;
  private history: ChatMessage[] = [];
  private client: LlmClient;

  constructor(client: LlmClient, systemPrompt: string) {
    this.client = client;
    this.system = msg.system(systemPrompt);
  }

  async say(userText: string): Promise<string> {
    this.history.push(msg.user(userText));
    const messages = [this.system, ...this.history];
    const answer = await this.client.chat(messages);
    this.history.push(msg.assistant(answer));
    return answer;
  }
}

async function main(): Promise<void> {
  const client = new LlmClient();
  const agent = new Agent(client, 'Ты — короткий ассистент. Отвечай не больше чем в 2 предложения.');

  console.log('Агент готов. Введите сообщение (пустая строка = выход):');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  while (true) {
    const line = await rl.question('> ');
    const trimmed = line.trim();
    if (!trimmed) {
      rl.close();
      return;
    }
    try {
      const answer = await agent.say(trimmed);
      console.log('Агент: ' + answer + '\n');
    } catch (err) {
      console.error('Ошибка: ' + (err as Error).message);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
