// ============================================================================
// День 9. Управление контекстом: сжатие истории
// ============================================================================
// ЗАДАНИЕ:
//   Реализуйте механизм управления контекстом:
//   - храните последние N сообщений «как есть»
//   - остальное заменяйте summary (например каждые 10 сообщений)
//   - храните summary отдельно и подставляйте его в запрос вместо полной истории
//
//   Сравните:
//   - качество ответов без сжатия
//   - качество ответов со сжатием
//   - расход токенов до/после
//
// РЕЗУЛЬТАТ: агент, который работает с компрессией истории и экономит токены.
// ФОРМАТ: видео + код.
// ============================================================================

import { type ChatMessage, type Usage, LlmClient, msg } from '@challenge/core';

const KEEP_LAST = 4;
const SUMMARIZE_EVERY = 4;

function emptyUsage(): Usage {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
}

async function summarize(client: LlmClient, msgs: ChatMessage[]): Promise<string> {
  const dialogue = msgs
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');
  return client.chat(
    [msg.user('Сожми следующий диалог в короткую выжимку ключевых фактов и решений:\n\n' + dialogue)],
    { maxTokens: 150 },
  );
}

async function turn(
  client: LlmClient,
  history: ChatMessage[],
  summary: { value: string | null },
  usage: Usage,
  userText: string,
): Promise<string> {
  history.push(msg.user(userText));

  if (history.length > KEEP_LAST && history.length % SUMMARIZE_EVERY === 0) {
    const toCompress = history.slice(0, history.length - KEEP_LAST);
    summary.value = await summarize(client, toCompress);
    const kept = history.slice(history.length - KEEP_LAST);
    history.length = 0;
    history.push(...kept);
  }

  const messages: ChatMessage[] = [];
  if (summary.value) {
    messages.push(msg.system('Summary предыдущего диалога: ' + summary.value));
  }
  messages.push(...history);

  const { content, usage: u } = await client.chatWithUsage(messages, { temperature: 0 });
  usage.prompt_tokens += u.prompt_tokens;
  usage.completion_tokens += u.completion_tokens;
  usage.total_tokens += u.total_tokens;
  console.log(
    `  [prompt=${u.prompt_tokens} completion=${u.completion_tokens} total=${u.total_tokens}]`,
  );
  history.push(msg.assistant(content));
  return content;
}

async function main(): Promise<void> {
  const client = new LlmClient();
  const history: ChatMessage[] = [];
  const summary = { value: null as string | null };
  const usage = emptyUsage();

  const turns = [
    'Я хочу сделать CLI-агента на TypeScript.',
    'Он должен сохранять историю в JSON.',
    'Используй провайдера DeepSeek.',
    'Какие библиотеки лучше взять?',
    'Напомним, что мы решили про хранение?',
    'Покажи пример функции save().',
    'А теперь добавим подсчёт токенов.',
    'Что мы обсуждали про провайдера?',
  ];

  for (const t of turns) {
    console.log('User: ' + t);
    const answer = await turn(client, history, summary, usage, t);
    console.log('Assistant: ' + answer + '\n');
  }

  console.log('=== Итоговое summary ===\n' + (summary.value ?? '(нет)'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
