// День 20. Telegram MCP-сервер: один инструмент send_to_chat (Bot API).
//
// Доставка брифинга в чат. Bot API (отправка) работает — сломан в day-19 был
// только MTProto-скан истории; нам чтение истории и не нужно. Конфиг —
// TG_BOT_TOKEN / TG_CHAT_ID из .env.
//
// Один тул: send_to_chat(text).

import { McpHttpServer } from '../core/mcpHttpServer.js';
import type { McpServerTool, McpToolResult } from '../core/mcpHttpServer.js';
import { getMcpAuth } from '../core/env.js';
import { publishPost, isTelegramConfigured } from '../core/agents/telegram.js';

const sendToChat: McpServerTool = {
  name: 'send_to_chat',
  description: 'Send a text message to the configured Telegram chat (Bot API). Needs TG_BOT_TOKEN/TG_CHAT_ID. Use to deliver a finished briefing.',
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string', description: 'Message text to send (Telegram limit ~4096 chars)' } },
    required: ['text'],
  },
  handler: async (args: Record<string, unknown>): Promise<McpToolResult> => {
    const text = args.text;
    if (typeof text !== 'string' || text.trim().length === 0) {
      return { content: [{ type: 'text', text: 'Invalid text: expected a non-empty string.' }], isError: true };
    }
    if (!isTelegramConfigured()) {
      return {
        content: [{ type: 'text', text: 'Telegram not configured (TG_BOT_TOKEN / TG_CHAT_ID).' }],
        isError: true,
      };
    }
    const result = await publishPost(text);
    if (!result.ok) {
      return { content: [{ type: 'text', text: `Failed to send: ${result.error}` }], isError: true };
    }
    return { content: [{ type: 'text', text: `Sent to Telegram (message_id=${result.messageId}).` }] };
  },
};

/** Поднять telegram-mcp HTTP-сервер на порту port. */
export async function runTelegramServer(port: number): Promise<McpHttpServer> {
  const server = new McpHttpServer({
    name: 'telegram-mcp',
    version: '1.0.0',
    tools: [sendToChat],
    port,
    authToken: getMcpAuth(),
  });
  await server.start();
  return server;
}
