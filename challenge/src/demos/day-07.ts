// ============================================================================
// День 7. Сохранение контекста
// ============================================================================
// ЗАДАНИЕ:
//   Добавьте агенту сохранение контекста в JSON. При перезапуске агент
//   подгружает историю и продолжает диалог как будто не выключался.
//
// РЕЗУЛЬТАТ: агент, который сохраняет и восстанавливает контекст между запусками.
//
// Примечание: файл истории лежит в challenge/.history/day-07-history.json.
// Запустите демо дважды — на втором запуске агент должен помнить первый диалог.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { type ChatMessage, LlmClient, msg } from '../core/index.js';
import type { Demo } from './types.js';

const HISTORY_FILE = path.join(process.cwd(), '.history', 'day-07-history.json');

async function loadHistory(): Promise<ChatMessage[]> {
  try {
    const text = await fs.readFile(HISTORY_FILE, 'utf8');
    return JSON.parse(text) as ChatMessage[];
  } catch {
    return [];
  }
}

async function saveHistory(history: ChatMessage[]): Promise<void> {
  await fs.mkdir(path.dirname(HISTORY_FILE), { recursive: true });
  await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
}

async function run(): Promise<void> {
  const client = new LlmClient();
  const history = await loadHistory();
  const system = msg.system('Ты короткий ассистент, отвечай не больше чем в 2 предложения.');
  console.log(`Загружено сообщений из истории: ${history.length}`);

  // Если история пуста — начинаем с заготовки. Если есть — задаём один вопрос,
  // чтобы проверить, что агент помнит прошлое.
  const turns = history.length === 0
    ? ['Я хочу сделать CLI-агента на TypeScript.', 'Какие библиотеки взять?']
    : ['Что мы обсуждали в прошлый раз?'];

  for (const t of turns) {
    console.log(`User: ${t}`);
    history.push(msg.user(t));
    try {
      const answer = await client.chat([system, ...history]);
      console.log(`Agent: ${answer}\n`);
      history.push(msg.assistant(answer));
      await saveHistory(history);
    } catch (err) {
      console.error('Ошибка: ' + (err as Error).message);
      history.pop();
      throw err;
    }
  }
}

export const demo: Demo = {
  id: 'day-07',
  title: 'Сохранение контекста в JSON',
  run,
};
