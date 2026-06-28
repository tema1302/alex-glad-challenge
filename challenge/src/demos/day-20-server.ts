// День 20. Серверная часть оркестрации «Брифинг дня».
//
// Один процесс поднимает ДВА MCP-сервера (требование дня Orchestration MCP):
//   • obsidian-mcp (порт 3020) — vault: read_note / search_notes / create_note
//   • world-mcp   (порт 3021) — внешний мир: get_current_time / fetch_url
// Это не демка и не in-process mock: персистентный сервис, как scheduler day-18.
// Деплоится на сервер и стоит. Клиент (day-20.ts / команда `agent`) подключается
// к обоим endpoint'ам и гонит кросс-серверный агентский флоу.
//
// Запуск: pnpm --filter challenge start -- day-20-server [--obsidian-port N] [--world-port N]

import { runObsidianServer } from './day-20-obsidian-server.js';
import { runWorldServer } from './day-20-world-server.js';

/**
 * Поднять оба MCP-сервера оркестрации в одном процессе и держать до SIGINT/SIGTERM.
 */
export async function runDay20Server(
  obsidianPort = 3020,
  worldPort = 3021,
): Promise<void> {
  const obsidian = await runObsidianServer(obsidianPort);
  const world = await runWorldServer(worldPort);
  console.error(
    `day-20 orchestration servers up: obsidian-mcp :${obsidianPort}, world-mcp :${worldPort}`,
  );

  const shutdown = (): void => {
    obsidian.stop();
    world.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
