// CLI монолита.
//
// Использование:
//   pnpm --filter challenge start                      # запустить последний день
//   pnpm --filter challenge start -- list              # список всех демо
//   pnpm --filter challenge start -- day-03            # конкретный день
//   pnpm --filter challenge start -- latest            # последний день

import { demos, findDemo, latestDemo } from './demos/registry.js';

function printHelp(): void {
  console.log('Использование:');
  console.log('  pnpm --filter challenge start -- <command>');
  console.log('');
  console.log('Команды:');
  console.log('  list       Список всех демо');
  console.log('  latest     Запустить последний день');
  console.log('  <id>       Запустить конкретный день (например, day-03)');
  console.log('  help       Эта справка');
}

async function main(): Promise<void> {
  const arg = process.argv[2];

  if (!arg || arg === 'latest') {
    const demo = latestDemo();
    console.log(`▶ Запуск: ${demo.id} — ${demo.title}\n`);
    await demo.run();
    return;
  }

  if (arg === 'list') {
    console.log('Доступные демо:');
    for (const d of demos) {
      console.log(`  ${d.id}   ${d.title}`);
    }
    return;
  }

  if (arg === 'help' || arg === '--help' || arg === '-h') {
    printHelp();
    return;
  }

  const demo = findDemo(arg);
  if (!demo) {
    console.error(`Демо "${arg}" не найдено. Доступные: ${demos.map((d) => d.id).join(', ')}`);
    console.error('Команда "pnpm --filter challenge start -- list" покажет все демо.');
    process.exit(1);
  }

  console.log(`▶ Запуск: ${demo.id} — ${demo.title}\n`);
  await demo.run();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
