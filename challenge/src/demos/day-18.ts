// День 18. Планировщик TODO + MCP→MCP + фоновые напоминания.
//
// Демонстрационный сценарий (не агент):
//   - Подключается к локальному MCP-серверу дня 18 как MCP-клиент.
//   - Показывает MCP→MCP: list_remote_tools → инструменты Everything Server.
//   - Добавляет TODO, показывает список, отправляет сводку, вызывает удалённый инструмент.

import { McpHttpClient } from '../core/mcpHttpClient.js';
import type { Demo } from './types.js';

const MCP_URL = process.env.MCP_SERVER_URL ?? 'http://localhost:3001/mcp';

export const demo: Demo = {
  id: 'day-18',
  title: 'Планировщик TODO + MCP→MCP + фоновые напоминания',
  run: async (): Promise<void> => {
    console.log('=== День 18. Планировщик TODO + MCP→MCP + фоновые напоминания ===\n');
    console.log(`Подключение к MCP-серверу: ${MCP_URL}`);

    const mcp = new McpHttpClient(MCP_URL);

    try {
      const info = await mcp.connect();
      console.log(`✓ Сервер: ${info.name} v${info.version} (протокол ${info.protocolVersion})`);

      const tools = await mcp.listTools();
      console.log(`✓ Инструментов: ${tools.length}`);
      for (const t of tools) {
        console.log(`  • ${t.name} — ${t.description ?? ''}`);
      }

      // --- MCP→MCP: показать инструменты удалённого Everything Server ---
      console.log('\n--- MCP→MCP: list_remote_tools ---');
      const remoteTools = await mcp.callTool('list_remote_tools', {});
      console.log(remoteTools);

      // --- TODO: добавить задачу ---
      console.log('\n--- TODO: add_todo ---');
      const addResult = await mcp.callTool('add_todo', { text: 'Демо-задача day-18: изучить MCP→MCP' });
      console.log(addResult);

      // --- TODO: показать список ---
      console.log('\n--- TODO: list_todos ---');
      const listResult = await mcp.callTool('list_todos', {});
      console.log(listResult);

      // --- Telegram: send_summary ---
      console.log('\n--- Telegram: send_summary ---');
      const summaryResult = await mcp.callTool('send_summary', {});
      console.log(summaryResult);

      // --- MCP→MCP: call_remote_tool (echo) ---
      console.log('\n--- MCP→MCP: call_remote_tool ("echo") ---');
      const echoResult = await mcp.callTool('call_remote_tool', {
        tool_name: 'echo',
        args: { message: 'Hello from day-18' },
      });
      console.log(echoResult);

      // --- Итоги ---
      console.log('\n=== Итог ===');
      console.log('• MCP-сервер дня 18 запускается отдельно: pnpm --filter challenge start -- scheduler');
      console.log(`• Клиент подключается по HTTP к ${MCP_URL}`);
      console.log(`• Инструменты (${tools.length}): ${tools.map((t) => t.name).join(', ')}`);
      console.log('• MCP→MCP: day-18 сервер проксирует вызовы к Everything Server');
      console.log('• Регулярный daily-summary: раз в день (SUMMARY_HOUR) шлёт сводку pending в Telegram');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`\nMCP-сервер не запущен или ошибка: ${msg}`);
      console.log('Запустите: pnpm --filter challenge start -- scheduler');
      return;
    } finally {
      mcp.disconnect();
    }
  },
};
