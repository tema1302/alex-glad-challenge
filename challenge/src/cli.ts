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
import readline from 'node:readline';

import { loadEnvUpward } from './core/env.js';
loadEnvUpward();

import { demos, findDemo, latestDemo } from './demos/registry.js';
import { runServer } from './demos/day-17-server.js';
import { runServer as runDay18Server } from './demos/day-18-server.js';
import { runDay20Server } from './demos/day-20-server.js';
import { runDay20 } from './demos/day-20.js';
import { startRepl } from './repl.js';
import { BlogDb, LlmClient, ProfileManager } from './core/index.js';
import { runNewsPipeline } from './core/agents/pipeline.js';
import { seedStyleSamples } from './core/agents/seed.js';
import { publishPost, isTelegramConfigured } from './core/agents/telegram.js';
import { McpHttpClient } from './core/mcpHttpClient.js';
import { parseTodoArgs } from './core/todoParser.js';
import { runAgentRequest } from './core/mcpAgentLoop.js';
import {
  RagStore,
  Retriever,
  makeEmbedder,
  makeLocalLlmClient,
  runIndexing,
  loadEval,
  runEval,
  runEvalAB,
  answerWithRag,
  answerNoRag,
  DEFAULT_RAG_THRESHOLD,
} from './core/rag/index.js';
import type { ChunkingStrategy, RagOptions } from './core/rag/index.js';

const DB_PATH = path.join(process.cwd(), '.data', 'blog.sqlite');
const PROFILE_DIR = path.join(process.cwd(), '.data', 'profiles');
const RAG_DB_PATH = path.join(process.cwd(), '.data', 'rag.sqlite');
const RAG_DOCS_DIR = path.join(process.cwd(), 'src', 'data', 'rag-sample');
const RAG_EVAL_FILE = path.join(process.cwd(), 'src', 'data', 'rag-eval.json');

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
  console.log('  rag index [path] Индексировать каталог документов в RAG-индекс (день 21, локальные эмбеддинги)');
  console.log('    --strategy <name>   только fixed | structure (по умолчанию обе)');
  console.log('  rag query "<q>"  Вопрос по индексу (день 22); нужен локальный LLM');
  console.log('    --no-rag            ответ без индекса (общие знания)');
  console.log('    --strategy <name>   fixed (по умолч.) | structure');
  console.log('    --k <N>             сколько чанков брать (по умолчанию 4)');
  console.log('  rag eval         10 контрольных вопросов: RAG vs без RAG');
  console.log('  rag chat         Интерактивный режим: вопрос за вопросом (/norag, /quit)');
  console.log('  mcp-server       Поднять локальный MCP HTTP-сервер (day-17)');
  console.log('    --port <N>         порт (по умолчанию 3001)');
  console.log('  scheduler        Поднять MCP-сервер day-18: TODO + MCP→MCP + фоновые напоминания');
  console.log('    --port <N>         порт (по умолчанию 3001)');
  console.log('  day-20-server    Поднять world-mcp + telegram-mcp (HTTP) для оркентсрации дня 20');
  console.log('    --port <N>         порт world-mcp (по умолчанию 3021); telegram-mcp = port+1');
  console.log('  day-20 [текст]   Оркестрация: filesystem-mcp (vault, stdio) + world-mcp. Текст = запрос');
  console.log('    --write           разрешить write_file и send_to_chat в Telegram (иначе dry-run)');
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

  if (arg === 'day-20-server') {
    const port = parsePort(argv.slice(1), 3021);
    console.log(`▶ Day-20 world-mcp: старт на http://localhost:${port}/mcp`);
    await runDay20Server(port);
    return;
  }

  if (arg === 'day-20') {
    const rest = argv.slice(1);
    const write = rest.includes('--write');
    const text = rest.filter((a) => a !== '--write').join(' ').trim();
    console.log(`▶ Day-20 оркестрация (${write ? 'write' : 'dry-run'})`);
    await runDay20(text || undefined, write);
    return;
  }

  if (arg === 'rag') {
    await runRagCommand(argv.slice(1));
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
  console.error('Команды: chat, list, latest, news, seed-style, db-stats, rag, mcp-server, scheduler, day-20-server, day-20, todo, remind, todos, done, summary, mcp, mcp-tools, help');
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

// --- RAG (дни 21–22): индекс / запрос / eval. Только локальные модели. ---

interface RagFlags {
  strategy?: ChunkingStrategy;
  k?: number;        // финальный topK (alias --topk)
  topk?: number;     // финальный topK (явный)
  pool?: number;     // candidate pool для retrieve
  threshold?: number;
  floor?: number;    // день 24: опц. floor для guard'а «не знаю» (minScore)
  rerank?: boolean;
  rewrite?: boolean;
  noRag?: boolean;
  ab?: boolean;
}

function parseRagFlags(argv: string[]): { flags: RagFlags; rest: string[] } {
  const flags: RagFlags = {};
  const rest: string[] = [];
  const num = (v: string): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--strategy' && argv[i + 1]) {
      const v = argv[++i];
      if (v === 'fixed' || v === 'structure') flags.strategy = v;
      continue;
    }
    if (a === '--k' && argv[i + 1]) { flags.k = num(argv[++i]); continue; }
    if (a === '--topk' && argv[i + 1]) { flags.topk = num(argv[++i]); continue; }
    if (a === '--pool' && argv[i + 1]) { flags.pool = num(argv[++i]); continue; }
    if (a === '--threshold' && argv[i + 1]) { flags.threshold = num(argv[++i]); continue; }
    if (a === '--floor' && argv[i + 1]) { flags.floor = num(argv[++i]); continue; }
    if (a === '--no-rag') { flags.noRag = true; continue; }
    if (a === '--rerank') { flags.rerank = true; continue; }
    if (a === '--no-rerank') { flags.rerank = false; continue; }
    if (a === '--rewrite') { flags.rewrite = true; continue; }
    if (a === '--no-rewrite') { flags.rewrite = false; continue; }
    if (a === '--ab') { flags.ab = true; continue; }
    rest.push(a);
  }
  return { flags, rest };
}

// Собирает RagOptions из флагов. --topk имеет приоритет над --k; pool по умолч. 20
// (candidate pool для реранка/фильтра); threshold по умолч. DEFAULT_RAG_THRESHOLD.
function buildRagOpts(flags: RagFlags): RagOptions {
  return {
    k: flags.topk ?? flags.k ?? 4,
    pool: flags.pool ?? 20,
    threshold: flags.threshold ?? DEFAULT_RAG_THRESHOLD,
    rerank: flags.rerank ?? false,
    rewrite: flags.rewrite ?? false,
    minScore: flags.floor,
  };
}

// Компактная печать этапов пайплайна (rewrite/retrieve/filter/rerank/llm) в rag query.
function printRagStage(stage: { step: string; detail: Record<string, unknown> }): void {
  if (stage.step === 'rewrite') {
    const d = stage.detail as { original: string; rewritten: string };
    console.log(`  [rewrite] "${d.original}" → "${d.rewritten}"`);
  } else if (stage.step === 'retrieve') {
    const d = stage.detail as { query: string; pool: number };
    console.log(`  [retrieve] pool=${d.pool}`);
  } else if (stage.step === 'filter') {
    const d = stage.detail as { before: number; after: number; threshold: number };
    console.log(`  [filter] ${d.before} → ${d.after} (threshold=${d.threshold})`);
  } else if (stage.step === 'rerank') {
    const d = stage.detail as { before: number; after: number; fallback: boolean; rankDelta: number };
    console.log(`  [rerank] ${d.before} → ${d.after} (fallback=${d.fallback}, Δrank=${d.rankDelta.toFixed(2)})`);
  } else if (stage.step === 'guard') {
    const d = stage.detail as { reason: 'empty' | 'floor'; filteredSize: number; maxScore: number };
    console.log(`  [guard] gaveUp: ${d.reason} (filteredSize=${d.filteredSize}, maxScore=${d.maxScore.toFixed(3)})`);
  } else if (stage.step === 'llm') {
    const d = stage.detail as { topK: number };
    console.log(`  [llm] topK=${d.topK}`);
  }
}

// live-индикатор ожидания локальной модели в RAG-чате: крутится, пока идёт
// LLM-вызов, чтобы REPL не выглядел зависшим. stop() затирает линию пробелами
// (без ANSI — работает в любом терминале).
function startSpinner(label: string): { stop: () => void } {
  const frames = ['|', '/', '-', '\\'];
  let i = 0;
  let maxLen = 0;
  const render = (): void => {
    const s = `  ${label}… ${frames[i % frames.length]}`;
    if (s.length > maxLen) maxLen = s.length;
    process.stdout.write('\r' + s);
    i++;
  };
  render();
  const id = setInterval(render, 150);
  return {
    stop() {
      clearInterval(id);
      process.stdout.write('\r' + ' '.repeat(maxLen) + '\r');
    },
  };
}

async function runRagCommand(argv: string[]): Promise<void> {
  const sub = argv[0];
  try {
    if (sub === 'index') {
      const { flags, rest } = parseRagFlags(argv.slice(1));
      const docsDir = rest[0] ?? RAG_DOCS_DIR;
      const strategies = flags.strategy ? [flags.strategy] : undefined;
      const store = new RagStore(RAG_DB_PATH);
      try {
        console.log(`▶ RAG index: ${docsDir} → ${RAG_DB_PATH}`);
        const result = await runIndexing(store, { docsDir, strategies });
        for (const s of Object.keys(result)) {
          const st = result[s];
          console.log(`  ${s}: ${st.chunks} чанков, среднее ${st.avgLen} симв, dim=${st.dim ?? '-'}`);
        }
      } finally {
        store.close();
      }
      return;
    }

    if (sub === 'query') {
      const { flags, rest } = parseRagFlags(argv.slice(1));
      const question = rest.join(' ').trim();
      if (!question) {
        console.error('Укажи вопрос: pnpm --filter challenge start -- rag query "..."');
        process.exit(1);
      }
      const strategy: ChunkingStrategy = flags.strategy ?? 'fixed';
      const client = makeLocalLlmClient();
      if (flags.noRag) {
        console.log(`▶ RAG query (без RAG): ${question}\n`);
        console.log(await answerNoRag(client, question));
        return;
      }
      const store = new RagStore(RAG_DB_PATH);
      try {
        if (store.count(strategy) === 0) {
          console.error(`Индекс пуст (${strategy}). Сначала: rag index`);
          process.exit(1);
        }
        const retriever = new Retriever(store, makeEmbedder(), strategy);
        const opts = buildRagOpts(flags);
        console.log(
          `▶ RAG query (${strategy}, pool=${opts.pool}, topK=${opts.k}, threshold=${opts.threshold}, rerank=${opts.rerank}, rewrite=${opts.rewrite}): ${question}\n`,
        );
        const { answer, sources, quotes, debug } = await answerWithRag(client, retriever, question, {
          ...opts,
          onProgress: printRagStage,
        });
        console.log('Источники:');
        for (const s of sources) {
          console.log(`  [${s.score.toFixed(3)}] ${s.chunk.metadata.source} | ${s.chunk.metadata.section}`);
        }
        if (quotes && quotes.length > 0) {
          console.log('Цитаты:');
          for (const q of quotes) {
            console.log(`  [${q.chunkId}] ${q.snippet}`);
          }
        }
        if (debug) {
          console.log(
            `\nОтладка: pool=${debug.poolSize} filtered=${debug.filteredSize} threshold=${debug.threshold} ` +
              `rerank=${debug.rerankApplied} fallback=${debug.fallback} Δrank=${debug.rankDelta.toFixed(2)} ` +
              `rewritten=${debug.rewritten}`,
          );
        }
        const guardLabel = debug?.gaveUp ? ' [guard: не знаю]' : '';
        console.log('\nОтвет:');
        console.log(answer + guardLabel);
      } finally {
        store.close();
      }
      return;
    }

    if (sub === 'eval') {
      const { flags } = parseRagFlags(argv.slice(1));
      const strategy: ChunkingStrategy = flags.strategy ?? 'fixed';
      const client = makeLocalLlmClient();
      const store = new RagStore(RAG_DB_PATH);
      try {
        if (store.count(strategy) === 0) {
          console.error(`Индекс пуст (${strategy}). Сначала: rag index`);
          process.exit(1);
        }
        const retriever = new Retriever(store, makeEmbedder(), strategy);
        const questions = await loadEval(RAG_EVAL_FILE);
        if (flags.ab) {
          const opts = buildRagOpts(flags);
          console.log(
            `▶ RAG eval A/B: ${questions.length} вопросов, стратегия ${strategy}, ` +
              `pool=${opts.pool}, topK=${opts.k}, threshold=${opts.threshold}\n`,
          );
          const result = await runEvalAB(client, retriever, questions, {
            k: opts.k,
            pool: opts.pool,
            threshold: opts.threshold,
          });
          console.log(`\n=== A/B: baseline (cosine-only) vs improved (+LLM rerank) ===`);
          const metrics: [string, number, number][] = [
            ['coversSources', result.baseline.coversSources, result.improved.coversSources],
            ['meanScore', result.baseline.meanScore, result.improved.meanScore],
            ['keptAfterFilter', result.baseline.keptAfterFilter, result.improved.keptAfterFilter],
            ['avgRankDelta', result.baseline.avgRankDelta, result.improved.avgRankDelta],
            ['questions', result.baseline.questions, result.improved.questions],
          ];
          console.log('  metric            | baseline | improved |     Δ');
          console.log('  ------------------|----------|----------|------');
          for (const [name, b, im] of metrics) {
            const d = im - b;
            const sign = d > 0 ? '+' : '';
            const fmt = (x: number): string => (Number.isInteger(x) ? String(x) : x.toFixed(3));
            const dv = Number.isInteger(d) ? `${sign}${d}` : `${sign}${d.toFixed(3)}`;
            console.log(
              `  ${name.padEnd(18)} | ${fmt(b).padStart(8)} | ${fmt(im).padStart(8)} | ${dv.padStart(5)}`,
            );
          }
          const fbRate = result.improved.questions > 0
            ? result.perQuestion.filter((r) => r.improved.debug?.fallback).length / result.improved.questions
            : 0;
          console.log(`\n  fallback rate (improved): ${(fbRate * 100).toFixed(0)}%`);
          console.log(`  avgRankDelta (improved): ${result.improved.avgRankDelta.toFixed(2)}`);
        } else {
          console.log(`▶ RAG eval: ${questions.length} вопросов, стратегия ${strategy}\n`);
          const rows = await runEval(client, retriever, questions);
          for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            console.log(`Q${i + 1}: ${r.question.q}`);
            console.log(`  без RAG: ${r.noRag.replace(/\s+/g, ' ').slice(0, 160)}`);
            console.log(`  с RAG:   ${r.withRag.replace(/\s+/g, ' ').slice(0, 160)}`);
            const src = r.sources.map((s) => `${s.source}(${s.score.toFixed(2)})`).join(', ');
            console.log(`  источники: ${src}\n`);
          }
        }
      } finally {
        store.close();
      }
      return;
    }

    if (sub === 'chat') {
      const { flags } = parseRagFlags(argv.slice(1));
      const strategy: ChunkingStrategy = flags.strategy ?? 'fixed';
      const opts = buildRagOpts(flags);
      const client = makeLocalLlmClient();
      const store = new RagStore(RAG_DB_PATH);
      try {
        if (store.count(strategy) === 0) {
          console.error(`Индекс пуст (${strategy}). Сначала: rag index`);
          process.exit(1);
        }
        const retriever = new Retriever(store, makeEmbedder(), strategy);
        const stagesOn = opts.rerank || opts.rewrite;
        console.log(
          `▶ RAG чат (${strategy}, pool=${opts.pool}, topK=${opts.k}, threshold=${opts.threshold}, ` +
            `rerank=${opts.rerank}, rewrite=${opts.rewrite}). Источник — мануал в индексе.`,
        );
        console.log('  /norag — переключить режим (с RAG / без RAG)');
        console.log('  /quit — выход\n');

        let noRag = false;
        const modelName = client.defaultModel;
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const prompt = (): void => rl.prompt();
        rl.setPrompt(`you (${noRag ? 'no-rag' : 'rag'})> `);
        rl.on('line', async (line) => {
          const q = line.trim();
          if (!q) { prompt(); return; }
          if (q === '/quit' || q === '/exit') { rl.close(); return; }
          if (q === '/norag') {
            noRag = !noRag;
            rl.setPrompt(`you (${noRag ? 'no-rag' : 'rag'})> `);
            console.log(`режим: ${noRag ? 'без RAG (общие знания)' : 'с RAG (по мануалу)'}`);
            prompt();
            return;
          }
          const t0 = Date.now();
          const spinner = startSpinner('думаю');
          try {
            if (noRag) {
              const answer = await answerNoRag(client, q);
              spinner.stop();
              const dt = Date.now() - t0;
              console.log('\n' + answer);
              console.log(`[model: ${modelName} | rag: — | ${dt}ms]\n`);
            } else {
              const { answer, sources, quotes, debug } = await answerWithRag(client, retriever, q, opts);
              spinner.stop();
              const dt = Date.now() - t0;
              const src = sources
                .map((s) => `${s.chunk.metadata.section}[${s.score.toFixed(2)}]`)
                .join(', ');
              console.log(`\nисточники: ${src}`);
              if (quotes && quotes.length > 0) {
                const qt = quotes.map((qq) => qq.snippet.replace(/\s+/g, ' ')).join(' / ');
                console.log(`цитаты: ${qt}`);
              }
              console.log(answer);
              // Базовая метка — как в дне 22. При включённых стадиях (rerank/rewrite)
              // показываем состав пайплайна: pool → filt → rerank → topK.
              const guardTag = debug?.gaveUp ? ' | guard: не знаю' : '';
              let label = `[model: ${modelName} | rag: ${sources.length} chunks | ${dt}ms${guardTag}]`;
              if (stagesOn && debug) {
                const stages =
                  `pool ${debug.poolSize} → filt ${debug.filteredSize}` +
                  (debug.rerankApplied ? ` → rerank ${sources.length}` : '');
                label = `[model: ${modelName} | rag: ${stages} | ${dt}ms${guardTag}]`;
              }
              console.log(`${label}\n`);
            }
          } catch (err) {
            spinner.stop();
            const m = err instanceof Error ? err.message : String(err);
            console.error(`ошибка: ${m}`);
          }
          prompt();
        });
        await new Promise<void>((res) => rl.once('close', res));
      } finally {
        store.close();
      }
      return;
    }

    console.error('Использование: rag index|query|eval|chat');
    process.exit(1);
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    console.error(`RAG ошибка: ${m}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
