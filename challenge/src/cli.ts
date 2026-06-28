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
import { runServer as runDay18Server } from './demos/day-18-server.js';
import { startRepl } from './repl.js';
import { BlogDb, LlmClient, ProfileManager } from './core/index.js';
import { runNewsPipeline } from './core/agents/pipeline.js';
import { seedStyleSamples } from './core/agents/seed.js';
import { publishPost, isTelegramConfigured } from './core/agents/telegram.js';
import { McpHttpClient } from './core/mcpHttpClient.js';
import { parseTodoArgs } from './core/todoParser.js';
import { runAgentRequest } from './core/mcpAgentLoop.js';

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
  console.log('  scheduler        Поднять MCP-сервер day-18: TODO + MCP→MCP + фоновые напоминания');
  console.log('    --port <N>         порт (по умолчанию 3001)');
  console.log('  agent "<запрос>"  Юзер вводит запрос → агент сам гонит цепочку MCP-тулов на сервере');
  console.log('    --server <url>     переопределить сервер (по умолчанию api.memo7.ru)');
  console.log('');
  console.log('  Команды для MCP-сервера (по умолчанию: https://api.memo7.ru/mcp):');
  console.log('  todo <text>      Добавить задачу (разовая)');
  console.log('    --daily            повторять каждый день');
  console.log('    --weekly <day>     повторять раз в неделю (0=Вс … 6=Сб)');
  console.log('    --hourly [N]        повторять каждые N часов (по умолчанию 1)');
  console.log('  remind <text>    Добавить напоминание (синоним todo)');
  console.log('  todos [--pending|--done|--dismissed]');
  console.log('                   Список задач (опциональный фильтр по статусу)');
  console.log('  done <id>        Завершить задачу');
  console.log('  dismiss <id>     Отклонить задачу');
  console.log('  rm-todo <id>     Удалить задачу');
  console.log('  summary          Отправить сводку ожидающих задач в Telegram');
  console.log('  mcp <tool> [args...]');
  console.log('                   Вызвать любой MCP-инструмент напрямую');
  console.log('    --json             вывести сырой JSON-ответ');
  console.log('  mcp-tools        Список всех MCP-инструментов на сервере');
  console.log('    --server <url>     для todo/remind/mcp: переопределить URL');
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

// --- MCP-клиент: команды для общения с сервером ---

const DEFAULT_MCP_URL = process.env.MCP_SERVER_URL ?? 'https://api.memo7.ru/mcp';

/** Извлечь --server <url> из argv; возвращает tuple [url, remainder]. */
function parseServerUrl(argv: string[]): [string, string[]] {
  const idx = argv.indexOf('--server');
  if (idx >= 0 && argv[idx + 1]) {
    return [argv[idx + 1], [...argv.slice(0, idx), ...argv.slice(idx + 2)]];
  }
  return [DEFAULT_MCP_URL, argv];
}

/** Подключиться к MCP-серверу и вызвать tool. */
async function callMcpTool(serverUrl: string, toolName: string, args?: Record<string, unknown>): Promise<string> {
  const client = new McpHttpClient(serverUrl);
  try {
    await client.connect();
    const result = await client.callTool(toolName, args);
    return result;
  } finally {
    client.disconnect();
  }
}

/** Подключиться и вызвать tool, вернув сырой JSON-RPC response. */
async function callMcpToolRaw(serverUrl: string, toolName: string, args?: Record<string, unknown>): Promise<unknown> {
  const client = new McpHttpClient(serverUrl);
  try {
    await client.connect();
    // @ts-expect-error — доступ к внутреннему request для сырого ответа
    const resp = await client.request('tools/call', { name: toolName, arguments: args ?? {} });
    return resp;
  } finally {
    client.disconnect();
  }
}

async function runMcpCommand(argv: string[]): Promise<void> {
  const [serverUrl, rest] = parseServerUrl(argv);
  const cmd = rest[0];
  const tail = rest.slice(1);

  try {
    switch (cmd) {
      // --- todo / remind: добавить задачу ---
      case 'todo':
      case 'remind': {
        const { text, args: parsed } = parseTodoArgs(tail);
        if (!text) {
          console.error('Укажи текст задачи: pnpm start -- todo "Сделать зарядку"');
          process.exit(1);
        }

        const result = await callMcpTool(serverUrl, 'add_todo', parsed);
        console.log(result);
        break;
      }

      // --- todos: список ---
      case 'todos': {
        const status = tail.find((a) => a === '--pending' || a === '--done' || a === '--dismissed');
        const statusMap: Record<string, string> = { '--pending': 'pending', '--done': 'done', '--dismissed': 'dismissed' };
        const args = status ? { status: statusMap[status] } : {};
        const result = await callMcpTool(serverUrl, 'list_todos', args);
        console.log(result);
        break;
      }

      // --- done: завершить ---
      case 'done': {
        const id = Number(tail.filter((a) => !a.startsWith('--'))[0]);
        if (!id || isNaN(id)) {
          console.error('Укажи ID: pnpm start -- done 3');
          process.exit(1);
        }
        const result = await callMcpTool(serverUrl, 'complete_todo', { id });
        console.log(result);
        break;
      }

      // --- dismiss: отклонить ---
      case 'dismiss': {
        const id = Number(tail.filter((a) => !a.startsWith('--'))[0]);
        if (!id || isNaN(id)) {
          console.error('Укажи ID: pnpm start -- dismiss 3');
          process.exit(1);
        }
        const result = await callMcpTool(serverUrl, 'dismiss_todo', { id });
        console.log(result);
        break;
      }

      // --- rm-todo: удалить ---
      case 'rm-todo': {
        const id = Number(tail.filter((a) => !a.startsWith('--'))[0]);
        if (!id || isNaN(id)) {
          console.error('Укажи ID: pnpm start -- rm-todo 3');
          process.exit(1);
        }
        const result = await callMcpTool(serverUrl, 'delete_todo', { id });
        console.log(result);
        break;
      }

      // --- summary: отправить в Telegram ---
      case 'summary': {
        const result = await callMcpTool(serverUrl, 'send_summary', {});
        console.log(result);
        break;
      }

      // --- mcp: произвольный вызов ---
      case 'mcp': {
        const toolName = tail[0];
        if (!toolName) {
          console.error('Укажи имя инструмента: pnpm start -- mcp add_todo');
          process.exit(1);
        }
        const toolArgsRaw = tail.slice(1);
        let toolArgs: Record<string, unknown> = {};

        // Парсим key=value пары, иначе всё как строка
        if (toolArgsRaw.length > 0) {
          const jsonIdx = toolArgsRaw.indexOf('--json');
          const argsPart = jsonIdx >= 0 ? toolArgsRaw.slice(0, jsonIdx) : toolArgsRaw;
          const useJson = jsonIdx >= 0;

          if (argsPart.length === 1) {
            // Один аргумент — пытаемся распарсить как JSON, иначе как строку
            try {
              toolArgs = JSON.parse(argsPart[0]);
            } catch {
              toolArgs = { text: argsPart[0] };
            }
          } else {
            // Несколько аргументов — key=value
            for (const part of argsPart) {
              const eqIdx = part.indexOf('=');
              if (eqIdx > 0) {
                const key = part.slice(0, eqIdx);
                const val: unknown = part.slice(eqIdx + 1);
                // Пытаемся парсить значение
                try { toolArgs[key] = JSON.parse(val as string); } catch { toolArgs[key] = val; }
              }
            }
          }

          if (useJson) {
            const raw = await callMcpToolRaw(serverUrl, toolName, toolArgs);
            console.log(JSON.stringify(raw, null, 2));
          } else {
            const result = await callMcpTool(serverUrl, toolName, toolArgs);
            console.log(result);
          }
        } else {
          const result = await callMcpTool(serverUrl, toolName, {});
          console.log(result);
        }
        break;
      }

      // --- mcp-tools: список инструментов ---
      case 'mcp-tools': {
        const client = new McpHttpClient(serverUrl);
        try {
          await client.connect();
          const tools = await client.listTools();
          if (tools.length === 0) {
            console.log('Нет инструментов на сервере.');
          } else {
            console.log(`Инструменты (${tools.length}):`);
            for (const t of tools) {
              console.log(`  ${t.name}${t.description ? ` — ${t.description}` : ''}`);
            }
          }
        } finally {
          client.disconnect();
        }
        break;
      }

      default:
        console.error(`Неизвестная MCP-команда: ${cmd}`);
        process.exit(1);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`MCP ошибка: ${msg}`);
    process.exit(1);
  }
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

  if (arg === 'scheduler') {
    const port = parsePort(argv.slice(1), 3001);
    console.log(`▶ Day-18 Scheduler MCP-сервер: старт на http://localhost:${port}/mcp`);
    await runDay18Server(port);
    return;
  }

  if (arg === 'agent') {
    const [serverUrl, rest] = parseServerUrl(argv.slice(1));
    const request = rest.join(' ').trim();
    if (!request) {
      console.error(
        'Укажи запрос: pnpm --filter challenge start -- agent "просканируй последние 200 сообщений в чате \'факты в чате\' и пришли отчёт"',
      );
      process.exit(1);
    }
    console.log(`▶ Агент → ${serverUrl}`);
    console.log(`  запрос: ${request}\n`);
    const agentClient = new LlmClient();
    try {
      const answer = await runAgentRequest(agentClient, serverUrl, request);
      console.log(`\nОтвет: ${answer}`);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      console.error(`agent error: ${m}`);
      process.exit(1);
    }
    return;
  }

  // --- MCP-клиент команды ---
  if (['todo', 'remind', 'todos', 'done', 'dismiss', 'rm-todo', 'summary', 'mcp', 'mcp-tools'].includes(arg)) {
    await runMcpCommand(argv);
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
  console.error('Команды: chat, list, latest, news, seed-style, db-stats, mcp-server, scheduler, todo, remind, todos, done, summary, mcp, mcp-tools, help');
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
