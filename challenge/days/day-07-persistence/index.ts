// ============================================================================
// День 7. Сохранение контекста
// ============================================================================
// ЗАДАНИЕ:
//   Добавьте агенту сохранение контекста:
//   - храните историю диалога (messages) в JSON или SQLite
//   - при перезапуске агента загружайте историю обратно
//   - продолжайте диалог так, как будто агент не выключался
//
//   Проверьте на практике:
//   - начните диалог
//   - перезапустите приложение
//   - продолжите диалог и убедитесь, что агент помнит прошлые сообщения
//
// РЕЗУЛЬТАТ: агент, который сохраняет и восстанавливает контекст между запусками.
// ФОРМАТ: видео + код.
// ============================================================================

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { type ChatMessage, LlmClient, msg } from '@challenge/core';

const HISTORY_FILE = path.join(process.cwd(), 'day-07-history.json');

async function loadHistory(): Promise<ChatMessage[]> {
  try {
    const text = await fs.readFile(HISTORY_FILE, 'utf8');
    return JSON.parse(text) as ChatMessage[];
  } catch {
    return [];
  }
}

async function saveHistory(history: ChatMessage[]): Promise<void> {
  await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
}

async function main(): Promise<void> {
  const client = new LlmClient();
  const history = await loadHistory();
  const system = msg.system(
    'Ты короткий ассистент, отвечай не больше чем в 2 предложения.',
  );
  console.log(`Загружено сообщений из истории: ${history.length}`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  while (true) {
    const line = await rl.question('> ');
    const trimmed = line.trim();
    if (!trimmed) {
      rl.close();
      return;
    }
    history.push(msg.user(trimmed));
    try {
      const answer = await client.chat([system, ...history]);
      console.log('Агент: ' + answer + '\n');
      history.push(msg.assistant(answer));
      await saveHistory(history);
    } catch (err) {
      console.error('Ошибка: ' + (err as Error).message);
      history.pop();
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
