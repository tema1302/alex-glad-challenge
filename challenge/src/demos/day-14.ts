// День 14. Инварианты и ограничения состояния.
//
// Задание:
//   Добавьте инварианты, которые ассистент не имеет права нарушать.
//   - выбранная архитектура
//   - принятые технические решения
//   - ограничения по стеку
//   - бизнес-правила
//   Инварианты хранятся отдельно от диалога.
//   Ассистент явно учитывает их в рассуждениях.
//   Ассистент отказывается предлагать решения, которые их нарушают.
//
// Реализация: core/constraints.ts (класс Constraints).
//   Хранятся в .data/constraints.json, отдельно от памяти и профиля.
//   Инжектируются в каждый промпт как жёсткий system-блок.
//   LLM инструктирован: ОТКАЖИСЬ если запрос нарушает инвариант, объясни причину.
//
// Демо:
//   1. Задаём 3 инварианта.
//   2. Запрос #1 (в рамках инвариантов) — LLM отвечает нормально.
//   3. Запрос #2 (нарушает инвариант стека) — LLM отказывает и объясняет.

import path from 'node:path';

import { Constraints, LlmClient, msg } from '../core/index.js';

export const demo = {
  id: 'day-14',
  title: 'Инварианты и ограничения: ассистент отказывает при конфликте',
  run: async (): Promise<void> => {
    const client = new LlmClient();
    const cPath = path.join(process.cwd(), '.data', 'constraints.json');
    const constraints = new Constraints(cPath);
    constraints.load();

    console.log('=== День 14. Инварианты и ограничения ===\n');

    // 1. Задаём инварианты (если ещё нет).
    console.log('1. Задаём инварианты...\n');
    if (constraints.count === 0) {
      constraints.add('stack', 'язык', 'Только TypeScript/Node.js. Никакого Rust, Python, Go.');
      constraints.add('architecture', 'монолит', 'Единый монолит challenge/ без микросервисов.');
      constraints.add('business', 'бюджет', 'Минимальные затраты. Никаких облачных сервисов с оплатой.');
    }
    for (const c of constraints.all) {
      console.log(`  ${c.id} [${c.type}] ${c.title}: ${c.description}`);
    }

    const systemBlock = constraints.toSystemMessages();

    // 2. Запрос в рамках инвариантов.
    console.log('\n2. Запрос в рамках инвариантов:\n');
    const q1 = 'Какую базу данных использовать для хранения постов?';
    console.log(`   user: ${q1}`);
    const ctx1 = [...systemBlock, msg.user(q1)];
    const a1 = await client.chat(ctx1, { temperature: 0.5, maxTokens: 500 });
    console.log(`   assistant: ${a1}\n`);

    // 3. Запрос, нарушающий инвариант стека.
    console.log('3. Запрос, нарушающий инвариант стека:\n');
    const q2 = 'Перепиши проект на Rust для максимальной производительности';
    console.log(`   user: ${q2}`);
    const ctx2 = [...systemBlock, msg.user(q2)];
    const a2 = await client.chat(ctx2, { temperature: 0.3, maxTokens: 500 });
    console.log(`   assistant: ${a2}\n`);

    // 4. Запрос, нарушающий бизнес-инвариант.
    console.log('4. Запрос, нарушающий бизнес-инвариант:\n');
    const q3 = 'Давай используем AWS RDS для базы данных, пофиг на стоимость';
    console.log(`   user: ${q3}`);
    const ctx3 = [...systemBlock, msg.user(q3)];
    const a3 = await client.chat(ctx3, { temperature: 0.3, maxTokens: 500 });
    console.log(`   assistant: ${a3}\n`);

    console.log('=== Вывод ===');
    console.log('Инварианты хранятся отдельно (.data/constraints.json).');
    console.log('LLM получает их как жёсткий system-блок в каждом запросе.');
    console.log('При конфликте LLM отказывает и объясняет, какой инвариант нарушен.');
    console.log('REPL: /constraints, /constraint add <type> <title>: <desc>, /constraint rm <id>');
  },
};
