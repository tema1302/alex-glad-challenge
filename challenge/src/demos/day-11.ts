// День 11. Модель памяти ассистента.
//
// Задание:
//   Опишите и реализуйте модель памяти для ассистента.
//   Разделите информацию минимум на 3 типа:
//     - краткосрочная (текущий диалог)
//     - рабочая (данные текущей задачи)
//     - долговременная (профиль, решения, знания)
//   Разные типы памяти хранятся отдельно. Вы явно выбираете, что и куда
//   сохраняется. Проверьте, как это влияет на ответы ассистента.
//
// Реализация: три слоя памяти в core/memory.ts (класс Memory).
//   - Short-term:  последние N сообщений (RAM, SlidingWindow по умолчанию 20).
//   - Working:     факты текущей задачи, ключ-значение (RAM, Map).
//   - Long-term:   профиль пользователя, знания (JSON-файл .data/memory.json).
//
// Демо: симуляция консультации по выбору стека технологий.
//   1. Long-term: сохраняем профиль пользователя (опыт, предпочтения).
//   2. Working: задаём задачу (выбор стека для проекта) и факты (бюджет, дедлайн).
//   3. Short-term: диалог — пользователь задаёт вопросы, ассистент отвечает,
//      имея доступ ко всем трём слоям.
//   4. Проверка: показываем, как long-term и working влияют на ответы LLM.
//   5. Long-term сохраняется на диск (переживает перезапуск), остальные слои —
//      только в RAM.

import path from 'node:path';

import { LlmClient, Memory, msg } from '../core/index.js';

export const demo = {
  id: 'day-11',
  title: 'Модель памяти ассистента: short-term, working, long-term',
  run: async (): Promise<void> => {
    const client = new LlmClient();
    const memPath = path.join(process.cwd(), '.data', 'memory.json');
    const mem = new Memory({ filePath: memPath, shortTermLimit: 10 });

    const SYSTEM = 'Ты — технический консультант. Отвечай кратко, учитывая контекст пользователя и задачи.';

    console.log('=== День 11. Модель памяти ассистента ===\n');

    // 1. Long-term: профиль пользователя.
    console.log('1. Сохраняем в long-term профиль пользователя...');
    mem.remember('имя', 'Артём');
    mem.remember('опыт', '5 лет в веб-разработке, TypeScript/Node.js, мало Rust');
    mem.remember('предпочтения', 'прагматичный подход, не любит оверинжиниринг');
    console.log('   long-term:', mem.longTermKeys);

    // 2. Working: задача и факты.
    console.log('\n2. Задаём working memory (текущая задача)...');
    mem.setTask('Выбор стека для нового проекта: блог-агенты для Telegram-канала');
    mem.setWorkingFact('бюджет', 'минимальный, без облака');
    mem.setWorkingFact('дедлайн', '1 неделя');
    mem.setWorkingFact('нагрузка', 'низкая, 1 пост в день');
    console.log('   задача:', mem.task);
    console.log('   факты:', mem.workingKeys);

    // 3. Short-term: первые сообщения.
    console.log('\n3. Начинаем диалог (short-term)...');
    mem.addMessage(msg.user('Какой стек посоветуешь?'));
    console.log('   user: Какой стек посоветуешь?');

    // 4. LLM вызов с полным контекстом (все три слоя).
    console.log('\n4. Отправляем в LLM (контекст = long-term + working + short-term)...');
    const ctx1 = mem.context(SYSTEM);
    console.log('   сообщений в контексте:', ctx1.length);
    printContextBreakdown(ctx1);

    const { content: ans1, usage: u1 } = await client.chatWithUsage(ctx1, { temperature: 0.7, maxTokens: 1000 });
    mem.addMessage(msg.assistant(ans1));
    console.log('\n   assistant:', ans1);
    console.log(`   (tokens: ${u1.total_tokens})`);

    // 5. Второй вопрос — short-term растёт.
    console.log('\n5. Второй вопрос (short-term растёт)...');
    mem.addMessage(msg.user('А если придётся масштабировать на 100 постов в день?'));
    console.log('   user: А если придётся масштабировать на 100 постов в день?');

    const { content: ans2, usage: u2 } = await client.chatWithUsage(mem.context(SYSTEM), { temperature: 0.7, maxTokens: 1000 });
    mem.addMessage(msg.assistant(ans2));
    console.log('\n   assistant:', ans2);
    console.log(`   (tokens: ${u2.total_tokens})`);

    // 6. Эксперимент: убираем long-term и смотрим, как меняется ответ.
    console.log('\n6. Эксперимент: убираем long-term (забываем профиль)...');
    mem.forget('имя');
    mem.forget('опыт');
    mem.forget('предпочтения');
    mem.clearShortTerm();
    mem.addMessage(msg.user('Какой стек посоветуешь?'));

    const { content: ans3 } = await client.chatWithUsage(mem.context(SYSTEM), { temperature: 0.7, maxTokens: 1000 });
    console.log('   user: Какой стек посоветуешь?');
    console.log('\n   assistant (без long-term):', ans3);
    console.log('   ^ ответ должен быть болееgeneric, без учёта вашего опыта TS/Node.');

    // 7. Сохраняем long-term на диск.
    console.log('\n7. Сохраняем long-term на диск...');
    mem.remember('имя', 'Артём');
    mem.remember('опыт', '5 лет в веб-разработке, TypeScript/Node.js');
    mem.saveLongTerm();
    console.log('   файл:', memPath);

    // 8. Snapshot.
    console.log('\n8. Snapshot памяти:');
    const snap = mem.snapshot();
    console.log('   short-term сообщений:', snap.shortTermCount);
    console.log('   working keys:', snap.workingKeys);
    console.log('   long-term entries:', snap.longTermEntries.length);
    for (const e of snap.longTermEntries) {
      console.log(`     - ${e.key}: ${e.value}`);
    }

    console.log('\n=== Вывод ===');
    console.log('Три слоя памяти управляются независимо:');
    console.log('  Short-term  — обновляется при каждом сообщении (RAM).');
    console.log('  Working     — факты задачи, явное управление (RAM).');
    console.log('  Long-term   — профиль, переживает перезапуск (JSON-файл).');
    console.log('LLM видит все три слоя, склеенные в один context[].');
  },
};

function printContextBreakdown(ctx: import('../core/index.js').ChatMessage[]): void {
  const roles = { system: 0, user: 0, assistant: 0 };
  for (const m of ctx) roles[m.role]++;
  console.log(`   system: ${roles.system}, user: ${roles.user}, assistant: ${roles.assistant}`);
}
