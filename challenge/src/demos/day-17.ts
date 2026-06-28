// День 17. Первый инструмент MCP: HTTP-сервер + агент-клиент.
//
// Задание:
//   Подключить агента к УЖЕ РАБОТАЮЩЕМУ standalone MCP-серверу по HTTP.
//   Агент сам выбирает инструмент в цикле tool-calling.
//
// Реализация:
//   core/mcpHttpClient.js — MCP-клиент поверх Streamable HTTP transport.
//   core/mcpAgentLoop.js — цикл tool-calling поверх MCP (текстовый протокол CALL/RESULT).
//   day-17.ts (этот файл) — демо-сценарий, прогоняющий агентский цикл.
//   Сервер запускается отдельно: pnpm --filter challenge start -- mcp-server
//
// Подход — текстовый протокол tool-calling (без нативного tools-API):
// Многие OpenAI-совместимые провайдеры ненадёжно поддерживают параметр tools,
// поэтому агент договаривается с моделью о строгом формате:
//   CALL: <tool_name> <json args>   — запрос на вызов инструмента,
//   RESULT: <текст>                 — результат, который агент возвращает модели.

import { LlmClient } from '../core/index.js';
import { McpHttpClient } from '../core/mcpHttpClient.js';
import { runAgentLoop } from '../core/mcpAgentLoop.js';
import type { Demo } from './types.js';

const MCP_URL = process.env.MCP_SERVER_URL ?? 'http://localhost:3001/mcp';

const SCENARIO_1 = 'Какие посты у пользователя с ID 2?';
const SCENARIO_2 = "Добавь заметку 'Изучить MCP протокол' и покажи все заметки";

export const demo: Demo = {
  id: 'day-17',
  title: 'Первый инструмент MCP: HTTP-сервер + агент-клиент',
  run: async (): Promise<void> => {
    console.log('=== День 17. Первый инструмент MCP: сервер + агент ===\n');
    console.log(`Подключение к MCP-серверу: ${MCP_URL}`);

    const mcp = new McpHttpClient(MCP_URL);
    const client = new LlmClient();

    try {
      const info = await mcp.connect();
      console.log(`✓ Сервер: ${info.name} v${info.version} (протокол ${info.protocolVersion})`);

      const tools = await mcp.listTools();
      console.log(`✓ Инструментов: ${tools.length}`);
      for (const t of tools) {
        console.log(`  • ${t.name} — ${t.description ?? ''}`);
      }

      console.log(`\n--- Сценарий 1: "${SCENARIO_1}" ---`);
      const answer1 = await runAgentLoop(client, mcp, tools, SCENARIO_1);
      console.log(`  Ответ: ${answer1}`);

      console.log(`\n--- Сценарий 2: "${SCENARIO_2}" ---`);
      const answer2 = await runAgentLoop(client, mcp, tools, SCENARIO_2);
      console.log(`  Ответ: ${answer2}`);

      console.log(`\n=== Итог ===`);
      console.log('• MCP-сервер запускается отдельно: pnpm --filter challenge start -- mcp-server');
      console.log(`• Агент подключается по HTTP к ${MCP_URL}`);
      console.log('• Tool-calling через текстовый протокол CALL/RESULT');
      console.log(`• Инструменты (${tools.length}): ${tools.map((t) => t.name).join(', ')}`);
    } catch {
      console.log(
        '\nMCP-сервер не запущен. Запустите: pnpm --filter challenge start -- mcp-server',
      );
      return;
    } finally {
      mcp.disconnect();
    }
  },
};
