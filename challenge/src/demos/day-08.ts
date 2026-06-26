// ============================================================================
// День 8. Работа с токенами
// ============================================================================
// ЗАДАНИЕ:
//   Подсчёт токенов для текущего запроса, для всей истории и для ответа.
//   Сравните короткий / длинный диалоги. Покажите, что ломается при переполнении.

import { type ChatMessage, type Usage, LlmClient, msg } from '../core/index.js';
import type { Demo } from './types.js';

function emptyUsage(): Usage {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
}

function printUsage(label: string, u: Usage, cum: Usage): void {
  console.log(label + ':');
  console.log(
    `  Запрос:  prompt=${u.prompt_tokens} completion=${u.completion_tokens} total=${u.total_tokens}`,
  );
  console.log(
    `  С накоплением: prompt=${cum.prompt_tokens} completion=${cum.completion_tokens} total=${cum.total_tokens}\n`,
  );
}

async function run(): Promise<void> {
  const client = new LlmClient();

  const turns = [
    'Привет, что ты умеешь?',
    'А теперь длинно объясни, как работает attention.',
    'Ещё подробнее и с примером кода.',
  ];

  let cum: Usage = emptyUsage();
  const history: ChatMessage[] = [msg.system('Ты ассистент.')];

  for (let i = 0; i < turns.length; i++) {
    history.push(msg.user(turns[i]));
    const { content, usage } = await client.chatWithUsage(history, { temperature: 0 });
    cum = {
      prompt_tokens: cum.prompt_tokens + usage.prompt_tokens,
      completion_tokens: cum.completion_tokens + usage.completion_tokens,
      total_tokens: cum.total_tokens + usage.total_tokens,
    };
    console.log(`--- Поворот ${i + 1} ---`);
    console.log('Пользователь: ' + turns[i]);
    const short = content.replace(/\n/g, ' ').slice(0, 80);
    console.log('Модель (обрезано): ' + short);
    printUsage(`Поворот ${i + 1}`, usage, cum);
    history.push(msg.assistant(content));
  }
}

export const demo: Demo = {
  id: 'day-08',
  title: 'Работа с токенами',
  run,
};
