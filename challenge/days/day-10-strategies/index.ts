// День 10. Управление контекстом: три стратегии + переключатель.
//   Sliding Window: только последние N сообщений
//   Sticky Facts: ключ-значение факты + последние N сообщений
//   Branching: чекпойнты и независимые ветки диалога
//
// Запуск с разными стратегиями через аргумент:
//   pnpm --filter day-10-strategies start -- sliding
//   pnpm --filter day-10-strategies start -- sticky
//   pnpm --filter day-10-strategies start -- branching
//   pnpm --filter day-10-strategies start              # all

import {
  Branching,
  type ContextStrategy,
  LlmClient,
  msg,
  SlidingWindow,
  StickyFacts,
} from '@challenge/core';

const TURNS = [
  'цель: сделать CLI-агента на TypeScript',
  'стек: tsx + node fetch',
  'бюджет: 10$ в месяц',
  'Напомни, какую цель мы поставили и какой стек выбрали.',
];

async function runStrategy(name: string, client: LlmClient, strat: ContextStrategy): Promise<void> {
  console.log(`\n=== Стратегия: ${name} ===`);
  for (const t of TURNS) {
    console.log('\nUser: ' + t);
    strat.addMessage(msg.user(t));
    const ctx = strat.context();
    let resp: string;
    try {
      resp = await client.chat(ctx, { temperature: 0 });
    } catch (err) {
      resp = '[ошибка: ' + (err as Error).message + ']';
    }
    console.log('Assistant: ' + resp);
    strat.addMessage(msg.assistant(resp));
    const s = strat.stats();
    console.log(
      `  [stats] total=${s.totalMessages} active=${s.activeMessages} dropped=${s.messagesDropped}`,
    );
  }
}

async function runBranching(client: LlmClient): Promise<void> {
  console.log('\n=== Стратегия: branching ===');
  const b = new Branching();
  b.addMessage(msg.system('Ты короткий ассистент.'));
  b.addMessage(msg.user('Сделаем CLI на TypeScript.'));
  const cp = b.checkpoint('после-старта');
  console.log('Создан чекпойнт id=' + cp);

  b.addMessage(msg.user('Ветка A: используем commander.'));
  b.switchTo(cp);
  b.addMessage(msg.user('Ветка B: используем ручной парсинг process.argv.'));

  for (const info of b.listBranches()) {
    console.log(`Ветка '${info.label}': ${info.messageCount} сообщений`);
  }
  for (const info of b.listBranches()) {
    b.switchTo(info.id);
    const ctx = b.context();
    let resp: string;
    try {
      resp = await client.chat(ctx, { temperature: 0 });
    } catch (err) {
      resp = '[ошибка: ' + (err as Error).message + ']';
    }
    console.log(`\nВетка ${info.id} -> ${resp}`);
  }
}

async function main(): Promise<void> {
  const client = new LlmClient();
  const kind = process.argv[2] ?? 'all';

  switch (kind) {
    case 'sliding':
      await runStrategy('sliding', client, new SlidingWindow(2));
      break;
    case 'sticky':
      await runStrategy('sticky', client, new StickyFacts(2));
      break;
    case 'branching':
      await runBranching(client);
      break;
    default:
      await runStrategy('sliding', client, new SlidingWindow(2));
      await runStrategy('sticky', client, new StickyFacts(2));
      await runBranching(client);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
