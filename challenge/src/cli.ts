// CLI монолита.
//
// Использование:
//   pnpm --filter challenge start                      # интерактивный REPL с агентом
//   pnpm --filter challenge start -- chat              # тот же REPL (по умолчанию)
//   pnpm --filter challenge start -- chat --strategy sliding
//   pnpm --filter challenge start -- chat --system "Ты ревьюер"
//   pnpm --filter challenge start -- list              # список всех демо
//   pnpm --filter challenge start -- day-03            # прогнать демо конкретного дня
//   pnpm --filter challenge start -- latest            # прогнать последний день
//   pnpm --filter challenge start -- help

import { demos, findDemo, latestDemo } from './demos/registry.js';
import { startRepl } from './repl.js';
import { LlmClient } from './core/index.js';

function printHelp(): void {
  console.log('Использование:');
  console.log('  pnpm --filter challenge start -- <command>');
  console.log('');
  console.log('Команды:');
  console.log('  (без аргумента)  Интерактивный REPL с агентом (вариант B)');
  console.log('  chat             То же самое — глобальный чат, внутри: /day, /strategy, /usage');
  console.log('    --strategy <name>  стартовая стратегия: full | sliding | sticky | branching');
  console.log('    --system <text>    стартовый system-промпт');
  console.log('  list             Список всех демо');
  console.log('  latest           Прогнать последний день (один запуск сценария)');
  console.log('  <id>             Прогнать демо конкретного дня (например day-03)');
  console.log('  help             Эта справка');
}

interface ChatFlags {
  strategy?: string;
  system?: string;
}

function parseChatFlags(argv: string[]): ChatFlags {
  const flags: ChatFlags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--strategy' && argv[i + 1]) { flags.strategy = argv[++i]; continue; }
    if (argv[i] === '--system' && argv[i + 1]) { flags.system = argv[++i]; continue; }
  }
  return flags;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const arg = argv[0];

  // По умолчанию (без аргумента) или явный chat — запускаем REPL.
  if (!arg || arg === 'chat') {
    const flags = parseChatFlags(argv.slice(1));
    const client = new LlmClient();
    await startRepl(client, {
      strategyName: flags.strategy,
      systemPrompt: flags.system,
    });
    return;
  }

  if (arg === 'list') {
    console.log('Доступные демо:');
    for (const d of demos) {
      console.log(`  ${d.id}   ${d.title}`);
    }
    return;
  }

  if (arg === 'latest') {
    const demo = latestDemo();
    console.log(`▶ Запуск: ${demo.id} — ${demo.title}\n`);
    await demo.run();
    return;
  }

  if (arg === 'help' || arg === '--help' || arg === '-h') {
    printHelp();
    return;
  }

  // Если это день из реестра — прогоняем демо.
  const demo = findDemo(arg);
  if (demo) {
    console.log(`▶ Запуск: ${demo.id} — ${demo.title}\n`);
    await demo.run();
    return;
  }

  console.error(`Неизвестная команда "${arg}".`);
  console.error('Доступные дни: ' + demos.map((d) => d.id).join(', '));
  console.error('Команды: chat, list, latest, help');
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
