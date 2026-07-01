// День 20. Серверная часть: world-mcp + telegram-mcp (оба HTTP) в одном процессе.
//
// filesystem-mcp спавнится самим оркестратором (stdio-child), поэтому здесь его
// нет — эти серверы поднимают HTTP-части: «внешний мир» (дата/fetch) и доставку
// брифинга в Telegram. Стоят персистентно как один сервис (как scheduler day-18).
//
// Запуск: pnpm --filter challenge start -- day-20-server [--port N]
//   --port задаёт порт world-mcp (по умолч. 3021); telegram-mcp = port+1 (3022).

import { runWorldServer } from './day-20-world-server.js';
import { runTelegramServer } from './day-20-telegram-server.js';

/** Поднять world-mcp (HTTP) + telegram-mcp (HTTP) и держать до SIGINT/SIGTERM. */
export async function runDay20Server(worldPort = 3021, telegramPort = worldPort + 1): Promise<void> {
  const world = await runWorldServer(worldPort);
  const telegram = await runTelegramServer(telegramPort);
  console.error(`day-20 servers up: world-mcp :${worldPort}, telegram-mcp :${telegramPort}`);

  const shutdown = (): void => {
    world.stop();
    telegram.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
