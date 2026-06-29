// День 20. Orchestration MCP — «Брифинг дня». Мульти-MCP, смешанный транспорт.
//
// Оркестратор смешивает ДВА разных транспорта:
//   • filesystem-mcp (официальный @modelcontextprotocol/server-filesystem) — stdio,
//     спавнится как child-процесс над реальным Obsidian vault. Чтение/навигация.
//   • world-mcp (свой HTTP-сервер, поднимается отдельной командой `day-20-server`)
//     — get_current_time + fetch_url.
// Роутер (core/mcpOrchestrator) не знает транспорт: видит (сервер, тулы) и шлёт
// каждый CALL на владельца.
//
// Запуск:
//   pnpm --filter challenge start -- day-20-server          # (один раз) world-mcp HTTP вверх
//   pnpm --filter challenge start -- day-20 "мой текст"     # произвольный запрос → прогон
//   pnpm --filter challenge start -- day-20                 # default-брифинг
//   ... --write                                              # включить write_file (иначе dry-run)

import path from 'node:path';
import { LlmClient, McpHttpClient } from '../core/index.js';
import { McpStdioClient } from '../core/mcp.js';
import { runOrchestrator } from '../core/mcpOrchestrator.js';
import type { McpClientLike, OrchestratorServer } from '../core/mcpOrchestrator.js';
import type { Demo } from './types.js';

const VAULT_DIR = process.env.OBSIDIAN_VAULT_DIR ?? path.join(process.cwd(), '.data', 'vault');
const WORLD_URL = process.env.WORLD_MCP_URL ?? 'http://localhost:3021/mcp';
const TELEGRAM_URL = process.env.TELEGRAM_MCP_URL ?? 'http://localhost:3022/mcp';
const FS_SERVER_JS = 'node_modules/@modelcontextprotocol/server-filesystem/dist/index.js';

/** Только чтение/навигация — безопасный скоуп для dry-run (без write/edit/move). */
const FS_READ_ONLY = [
  'read_text_file',
  'read_multiple_files',
  'list_directory',
  'directory_tree',
  'search_files',
  'get_file_info',
  'list_allowed_directories',
];

const DEFAULT_REQUEST = [
  'Собери утренний брифинг на сегодня.',
  'Сначала узнай сегодняшнюю дату (get_current_time).',
  'Через list_directory осмотри папки vault: Семья, Проекты, FrontLead.',
  'Прочитай (read_text_file) 2–4 самые релевантные заметки про текущие задачи по работе, семье, проектам.',
  'Если write_file доступен — запиши сводку заметкой «Брифинг <дата>» в корень vault с блоками Работа / Семья / Проекты. Если нет — перечисли найденное в финальном ответе.',
  'В конце кратко скажи, что посмотрел.',
].join(' ');

interface RunOptions {
  request: string;
  write: boolean;
}

/** Адаптер stdio-клиента под McpClientLike: оркестратор зовёт callTool → текст. */
function adaptStdio(stdio: McpStdioClient): McpClientLike {
  return {
    callTool: (name: string, args: Record<string, unknown>) => stdio.callToolText(name, args),
  };
}

async function runBriefing(opts: RunOptions): Promise<void> {
  console.log('=== День 20. Orchestration MCP — mixed transport ===\n');
  console.log(`Транспорт: filesystem-mcp (stdio) + world-mcp (HTTP ${WORLD_URL})`);
  console.log(`Vault: ${VAULT_DIR}`);
  console.log(`Режим: ${opts.write ? 'WRITE (write_file + send_to_chat в Telegram)' : 'DRY-RUN (только чтение)'}`);
  console.log(`\nЗапрос:\n  ${opts.request}\n`);

  // filesystem-mcp: спавн stdio-child над vault. process.execPath (абсолютный путь к
  // node) + shell:false — обходит Windows ENOENT и deprecation-варнинг.
  const stdio = new McpStdioClient(process.execPath, [FS_SERVER_JS, VAULT_DIR], undefined, false);
  await stdio.connect();
  const fsTools = await stdio.listTools();
  const servers: OrchestratorServer[] = [
    {
      name: 'filesystem-mcp',
      client: adaptStdio(stdio),
      tools: fsTools,
      allowTools: opts.write ? undefined : FS_READ_ONLY,
    },
  ];

  console.log('Серверы и инструменты:');
  console.log(
    `  [filesystem-mcp] ${fsTools.length} тулов` +
      `${servers[0].allowTools ? ` (видимо агенту: ${servers[0].allowTools.join(', ')})` : ''}`,
  );

  // world-mcp: HTTP (должен быть поднят отдельной командой).
  const worldHttp = new McpHttpClient(WORLD_URL);
  let worldConnected = false;
  try {
    await worldHttp.connect();
    const worldTools = await worldHttp.listTools();
    servers.push({ name: 'world-mcp', client: worldHttp, tools: worldTools });
    console.log(`  [world-mcp] ${worldTools.map((t) => t.name).join(', ')}`);
    worldConnected = true;
  } catch (err) {
    console.log(`  [world-mcp] недоступен — ${err instanceof Error ? err.message : err}`);
    console.log('  (подними: pnpm --filter challenge start -- day-20-server)');
  }

  // telegram-mcp: HTTP, ТОЛЬКО в write-режиме (dry-run не доставляет в чат).
  const telegramHttp = new McpHttpClient(TELEGRAM_URL);
  let telegramConnected = false;
  if (opts.write) {
    try {
      await telegramHttp.connect();
      const tgTools = await telegramHttp.listTools();
      servers.push({ name: 'telegram-mcp', client: telegramHttp, tools: tgTools });
      console.log(`  [telegram-mcp] ${tgTools.map((t) => t.name).join(', ')}`);
      telegramConnected = true;
    } catch (err) {
      console.log(`  [telegram-mcp] недоступен — ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log('\nАгентский цикл (CALL → сервер):');
  const client = new LlmClient();
  try {
    const { answer, trace } = await runOrchestrator(client, servers, opts.request, {
      maxIterations: 12,
      extraSystem:
        'Ты работаешь с реальным Obsidian vault через filesystem-mcp. ' +
        'ВАЖНО: filesystem-mcp принимает ТОЛЬКО абсолютные пути внутри vault. ' +
        'Сначала вызови list_allowed_directories — это даст корень vault; подставляй его ' +
        'ко всем путям в list_directory / read_text_file (например <корень>/Семья). ' +
        'Относительные пути и пути вне vault запрещены. ' +
        'Дату бери через get_current_time (world-mcp). ' +
        (opts.write
          ? 'write_file включён — сохрани брифинг заметкой в vault, затем отправь его краткую версию через send_to_chat (telegram-mcp) в чат.'
          : 'write_file НЕ доступен (dry-run) — НЕ пытайся писать/отправлять, дай ответ текстом.'),
    });

    console.log('\nTrace маршрутизации:');
    for (const [i, t] of trace.entries()) console.log(`  ${i + 1}. ${t.tool}  →  [${t.server}]`);
    const multiServer = new Set(trace.map((t) => t.server)).size > 1;
    console.log(`  Разные серверы в одном флоу: ${multiServer ? 'да ✓' : 'нет'}`);

    console.log('\nФинальный ответ:');
    console.log(answer);
  } finally {
    stdio.disconnect();
    if (worldConnected) worldHttp.disconnect();
    if (telegramConnected) telegramHttp.disconnect();
  }
}

export const demo: Demo = {
  id: 'day-20',
  title: 'Orchestration MCP: Брифинг дня (filesystem + world, mixed transport)',
  run: async (): Promise<void> => {
    // Запуск как демо реестра — default-запрос, dry-run.
    await runBriefing({ request: DEFAULT_REQUEST, write: false });
  },
};

/** Точка входа для CLI: произвольный текст юзера (пусто → default-брифинг). */
export async function runDay20(request?: string, write = false): Promise<void> {
  await runBriefing({ request: request?.trim() || DEFAULT_REQUEST, write });
}
