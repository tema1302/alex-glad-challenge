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
//   pnpm --filter challenge start -- news              # блог-pipeline: rss → 3 агента → пост
//   pnpm --filter challenge start -- news --hours 48
//   pnpm --filter challenge start -- news --publish     # опубликовать пост в Telegram
//   pnpm --filter challenge start -- seed-style        # залить образцы стиля в БД
//   pnpm --filter challenge start -- help

import path from 'node:path';

import { loadEnvUpward } from './core/env.js';
loadEnvUpward();

import { demos, findDemo, latestDemo } from './demos/registry.js';
import { runServer } from './demos/day-17-server.js';
import { startRepl } from './repl.js';
import { BlogDb, LlmClient, ProfileManager } from './core/index.js';
import { runNewsPipeline } from './core/agents/pipeline.js';
import { seedStyleSamples } from './core/agents/seed.js';
import { publishPost, isTelegramConfigured } from './core/agents/telegram.js';

const DB_PATH = path.join(process.cwd(), '.data', 'blog.sqlite');
const PROFILE_DIR = path.join(process.cwd(), '.data', 'profiles');

function printHelp(): void {
  console.log('Использование:');
  console.log('  pnpm --filter challenge start -- <command>');
  console.log('');
  console.log('Команды:');
  console.log('  (без аргумента)  Интерактивный REPL с агентом (вариант B)');
  console.log('  chat             То же самое — глобальный чат, внутри: /day, /strategy, /usage');
  console.log('    --strategy <name>  стартовая стратегия: full | sliding | sticky | branching');
  console.log('    --system <text>    стартовый system-промпт');
  console.log('  list             Список всех дней');
  console.log('  latest           Прогнать последний день');
  console.log('  day-NN           Прогнать демо конкретного дня (day-01, day-14, day-15, ...)');
  console.log('                   ВАЖНО: дефис, не пробел! "day-14" — верно, "day 14" — не сработает.');
  console.log('  news             Блог-pipeline: RSS → агент 1 → агент 2 → агент 3');
  console.log('    --hours <N>        окно свежести (по умолчанию 24)');
  console.log('    --top <N>          сколько топ-новостей брать (по умолчанию 5)');
  console.log('    --for <i>          индекс новости из топа для поста (0 = самая хайповая)');
  console.log('    --publish          опубликовать готовый пост в Telegram (только если verdict=ok)');
  console.log('  seed-style       Залить образцы стиля канала в БД (один раз)');
  console.log('  db-stats         Статистика БД: сколько новостей/постов/образцов');
  console.log('  mcp-server       Поднять локальный MCP HTTP-сервер (day-17)');
  console.log('    --port <N>         порт (по умолчанию 3001)');
  console.log('  help             Эта справка');
}

interface ChatFlags {
  strategy?: string;
  system?: string;
}

/** Парсит --port <N> из argv; возвращает default если флаг отсутствует. */
function parsePort(argv: string[], defaultPort: number): number {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' && argv[i + 1]) {
      const n = Number(argv[++i]);
      if (Number.isInteger(n) && n > 0 && n < 65536) return n;
    }
  }
  return defaultPort;
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

  if (arg === 'news') {
    await runNewsCommand(argv.slice(1));
    return;
  }

  if (arg === 'seed-style') {
    await runSeedStyleCommand();
    return;
  }

  if (arg === 'db-stats') {
    runDbStatsCommand();
    return;
  }

  if (arg === 'help' || arg === '--help' || arg === '-h') {
    printHelp();
    return;
  }

  if (arg === 'mcp-server') {
    const port = parsePort(argv.slice(1), 3001);
    console.log(`▶ MCP HTTP-сервер: старт на http://localhost:${port}/mcp`);
    console.log('  Инструменты: get_user_posts, get_todos, add_note, list_notes');
    console.log('');
    await runServer(port);
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
  console.error('Команды: chat, list, latest, news, seed-style, db-stats, mcp-server, help');
  process.exit(1);
}

// --- подкоманды для блога ---

interface NewsFlags { hours?: number; top?: number; forIndex?: number; publish?: boolean; }

function parseNewsFlags(argv: string[]): NewsFlags {
  const flags: NewsFlags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--hours' && argv[i + 1]) { flags.hours = Number(argv[++i]); continue; }
    if (argv[i] === '--top' && argv[i + 1]) { flags.top = Number(argv[++i]); continue; }
    if (argv[i] === '--for' && argv[i + 1]) { flags.forIndex = Number(argv[++i]); continue; }
    if (argv[i] === '--publish') { flags.publish = true; continue; }
  }
  return flags;
}

async function runNewsCommand(argv: string[]): Promise<void> {
  const flags = parseNewsFlags(argv);
  const client = new LlmClient();
  const db = new BlogDb(DB_PATH);
  try {
    console.log('▶ Блог-pipeline: RSS → агент 1 → агент 2 → агент 3\n');
    const profile = new ProfileManager(PROFILE_DIR);
    const names = profile.list();
    if (names.length > 0) {
      profile.load(names.includes('default') ? 'default' : names[0]);
    } else {
      profile.create('default');
    }
    const result = await runNewsPipeline(db, client, {
      maxAgeHours: flags.hours,
      topK: flags.top,
      writeForIndex: flags.forIndex,
      profile,
    });

    console.log('\n=== Топ-новости (агент 1) ===');
    for (const r of result.news.ranked) {
      console.log(`  [${r.score}] ${r.news.title}  (${r.why})`);
    }

    if (!result.post) {
      console.log('\nНет подходящих новостей для поста.');
      return;
    }

    console.log('\n=== Пост (агент 2) ===');
    console.log(result.post.content);

    if (result.factCheck) {
      console.log('\n=== Фактчекинг (агент 3) ===');

      // Chain-of-thought рассуждения агенту 3 — показать ход мысли.
      if (result.factCheck.reasoning.trim()) {
        console.log('\n--- ход рассуждений ---');
        console.log(result.factCheck.reasoning.trim());
        console.log('--- конец рассуждений ---\n');
      }

      console.log(`verdict: ${result.factCheck.verdict}`);
      console.log(`recommendation: ${result.factCheck.recommendation}`);
      if (result.factCheck.issues.length > 0) {
        console.log('issues:');
        for (const issue of result.factCheck.issues) {
          console.log(`  [${issue.severity}] ${issue.claim}`);
          console.log(`         vs: ${issue.source}`);
        }
      } else {
        console.log('issues: нет');
      }
    }

    // Публикация в Telegram (флаг --publish).
    if (flags.publish) {
      if (!isTelegramConfigured()) {
        console.log('\n[telegram] TG_BOT_TOKEN или TG_CHAT_ID не заданы в .env — пропуск.');
      } else if (result.factCheck && result.factCheck.verdict !== 'ok') {
        console.log('\n[telegram] verdict != ok — пост НЕ опубликован (нужна правка).');
      } else {
        console.log('\n[telegram] Публикую пост в канал...');
        const tg = await publishPost(result.post.content);
        if (tg.ok) {
          console.log(`[telegram] Пост опубликован (message_id=${tg.messageId}).`);
        } else {
          console.error(`[telegram] Ошибка: ${tg.error}`);
        }
      }
    }
  } finally {
    db.close();
  }
}

async function runSeedStyleCommand(): Promise<void> {
  const db = new BlogDb(DB_PATH);
  try {
    const added = await seedStyleSamples(db);
    console.log(`Залито образцов стиля: ${added}. Всего в БД: ${db.styleSamplesCount()}.`);
  } finally {
    db.close();
  }
}

function runDbStatsCommand(): void {
  const db = new BlogDb(DB_PATH);
  try {
    console.log(`news:           ${db.newsCount()}`);
    console.log(`posts:          ${db.postsCount()}`);
    console.log(`style_samples:  ${db.styleSamplesCount()}`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
