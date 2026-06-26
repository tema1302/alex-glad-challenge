// День 16. MCP-клиент: соединение с сервером claude-in-mobile.
//
// Задание:
//   Написать код общения с MCP-сервером claude-in-mobile. Сделать минимальный
//   код, который:
//     - устанавливает MCP-соединение
//     - получает от MCP список доступных инструментов
//
// Реализация:
//   core/mcp.ts — минимальный MCP-клиент: JSON-RPC 2.0 поверх stdio дочернего
//   процесса. Проводит handshake (initialize → notifications/initialized),
//   затем вызывает tools/list.
//   day-16.ts — сценарий: запускает claude-in-mobile, печатает serverInfo и
//   список инструментов.
//
// Спека MCP: https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle

import { McpStdioClient } from '../core/mcp.js';

export const demo = {
  id: 'day-16',
  title: 'MCP-клиент: соединение и список инструментов',
  run: async (): Promise<void> => {
    console.log('=== День 16. MCP-клиент: claude-in-mobile ===\n');

    // claude-in-mobile — это MCP-сервер для управления Android/iOS/десктопом.
    // Запускается как дочерний процесс, общается по stdio (JSON-RPC 2.0).
    const client = new McpStdioClient('claude-in-mobile', []);

    try {
      // 1. MCP-handshake: initialize → notifications/initialized.
      console.log('1. Устанавливаем MCP-соединение...\n');
      const { protocolVersion, serverInfo } = await client.connectAndList();
      console.log(`  protocol: ${protocolVersion}`);
      console.log(`  server:   ${serverInfo.name} v${serverInfo.version}`);

      // 2. Список инструментов.
      const tools = await client.listTools();
      console.log(`\n2. Инструментов доступно: ${tools.length}\n`);
      for (const t of tools) {
        const desc = t.description ? ` — ${t.description}` : '';
        console.log(`  • ${t.name}${desc}`);
      }

      console.log(`\n=== Итог ===`);
      console.log(`  MCP-handshake прошёл (initialize + initialized).`);
      console.log(`  Получен список из ${tools.length} инструментов.`);
      console.log(`  Каждый инструмент — это callable tool по JSON-RPC.`);
    } finally {
      client.disconnect();
    }
  },
};
