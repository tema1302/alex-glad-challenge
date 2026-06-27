// День 18. Расширенный MCP HTTP-сервер с TODO-задачами и MCP→MCP подключением.
//
// Standalone MCP HTTP-сервер (как day-17), но с:
//   - TodoDb: добавление, список, выполнение, отклонение, удаление задач.
//   - Telegram: отправка сводки ожидающих задач в канал.
//   - MCP→MCP: подключение к Everything Server, проксирование вызовов инструментов.
//
// 8 зарегистрированных инструментов:
//   - add_todo, list_todos, complete_todo, dismiss_todo, delete_todo
//   - send_summary (Telegram)
//   - call_remote_tool, list_remote_tools (MCP→MCP)
//
// Фоновый цикл каждые 60 секунд проверяет due-задачи и отправляет в Telegram.

import path from 'node:path';
import { McpHttpServer } from '../core/mcpHttpServer.js';
import type { McpServerTool, McpToolResult } from '../core/mcpHttpServer.js';
import { McpHttpClient } from '../core/mcpHttpClient.js';
import { TodoDb } from '../core/todoDb.js';
import { publishPost, isTelegramConfigured } from '../core/agents/telegram.js';

const EVERYTHING_SERVER_URL = 'https://everything.mcp.inevitable.fyi/mcp';
const BG_INTERVAL_MS = 60_000;

/**
 * Создаёт и запускает standalone MCP HTTP-сервер дня 18.
 * Подключается к Everything Server, регистрирует 8 инструментов,
 * запускает фоновый цикл проверки due-задач.
 */
export async function runServer(port = 3001): Promise<void> {
  // --- TodoDb ---
  const dbPath = path.join(process.cwd(), '.data', 'todos.sqlite');
  const todoDb = new TodoDb(dbPath);
  console.error(`TodoDb initialised at ${dbPath}`);

  // --- MCP→MCP: подключение к Everything Server ---
  const remoteMcp = new McpHttpClient(EVERYTHING_SERVER_URL);
  let remoteTools: Awaited<ReturnType<McpHttpClient['listTools']>> = [];

  try {
    const info = await remoteMcp.connect();
    remoteTools = await remoteMcp.listTools();
    console.error(
      `Connected to remote MCP server "${info.name}" (${remoteTools.length} tools)`,
    );
    for (const t of remoteTools) {
      console.error(`  - ${t.name}${t.description ? `: ${t.description}` : ''}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to connect to remote MCP server: ${msg}`);
    console.error('Remote tools will be unavailable.');
  }

  // --- Инструменты ---

  const addTodoTool: McpServerTool = {
    name: 'add_todo',
    description: 'Add a new todo task. Optionally schedule it or make it recurring.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Task text',
        },
        scheduled_at: {
          type: 'string',
          description: 'ISO timestamp for scheduled execution (optional)',
        },
        recurring: {
          type: 'string',
          enum: ['daily', 'weekly', 'hourly'],
          description: 'Recurring frequency (optional)',
        },
        day_of_week: {
          type: 'integer',
          minimum: 0,
          maximum: 6,
          description: 'Day of week for weekly recurring (0=Sunday, 6=Saturday, optional)',
        },
        interval_hours: {
          type: 'integer',
          minimum: 1,
          description: 'Interval in hours for hourly recurring (optional, default=1).',
        },
      },
      required: ['text'],
    },
    handler: async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const text = args.text;
      if (typeof text !== 'string' || text.trim().length === 0) {
        return {
          content: [{ type: 'text', text: 'Invalid text: expected a non-empty string.' }],
          isError: true,
        };
      }

      const scheduledAt = typeof args.scheduled_at === 'string' ? args.scheduled_at : undefined;
      const recurring =
        typeof args.recurring === 'string' && (args.recurring === 'daily' || args.recurring === 'weekly' || args.recurring === 'hourly')
          ? args.recurring
          : undefined;
      const dayOfWeek = typeof args.day_of_week === 'number' ? args.day_of_week : undefined;
      const intervalHours =
        typeof args.interval_hours === 'number' ? args.interval_hours : undefined;

      const id = todoDb.addTodo(text, scheduledAt, recurring, dayOfWeek, intervalHours);
      return {
        content: [{ type: 'text', text: `Todo added with id ${id}: ${text}` }],
      };
    },
  };

  const listTodosTool: McpServerTool = {
    name: 'list_todos',
    description: 'List todo tasks, optionally filtered by status.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'done', 'dismissed'],
          description: 'Filter by status (optional)',
        },
      },
    },
    handler: async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const status =
        typeof args.status === 'string' ? args.status : undefined;
      const rows = todoDb.listTodos(status);

      if (rows.length === 0) {
        return { content: [{ type: 'text', text: 'No todos found.' }] };
      }

      const lines = rows.map(
        (r) => `[${r.id}] (${r.status}) ${r.text}${r.recurring ? ` [${r.recurring}]` : ''}`,
      );
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  };

  const completeTodoTool: McpServerTool = {
    name: 'complete_todo',
    description: 'Mark a todo as completed.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Todo ID' },
      },
      required: ['id'],
    },
    handler: async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const id = args.id;
      if (typeof id !== 'number' || !Number.isInteger(id)) {
        return {
          content: [{ type: 'text', text: 'Invalid id: expected an integer.' }],
          isError: true,
        };
      }
      const ok = todoDb.completeTodo(id);
      if (!ok) {
        return {
          content: [{ type: 'text', text: `Todo ${id} not found or already completed.` }],
          isError: true,
        };
      }
      return { content: [{ type: 'text', text: `Todo ${id} marked as done.` }] };
    },
  };

  const dismissTodoTool: McpServerTool = {
    name: 'dismiss_todo',
    description: 'Dismiss a todo task.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Todo ID' },
      },
      required: ['id'],
    },
    handler: async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const id = args.id;
      if (typeof id !== 'number' || !Number.isInteger(id)) {
        return {
          content: [{ type: 'text', text: 'Invalid id: expected an integer.' }],
          isError: true,
        };
      }
      const ok = todoDb.dismissTodo(id);
      if (!ok) {
        return {
          content: [{ type: 'text', text: `Todo ${id} not found.` }],
          isError: true,
        };
      }
      return { content: [{ type: 'text', text: `Todo ${id} dismissed.` }] };
    },
  };

  const deleteTodoTool: McpServerTool = {
    name: 'delete_todo',
    description: 'Delete a todo task permanently.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Todo ID' },
      },
      required: ['id'],
    },
    handler: async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const id = args.id;
      if (typeof id !== 'number' || !Number.isInteger(id)) {
        return {
          content: [{ type: 'text', text: 'Invalid id: expected an integer.' }],
          isError: true,
        };
      }
      const ok = todoDb.deleteTodo(id);
      if (!ok) {
        return {
          content: [{ type: 'text', text: `Todo ${id} not found.` }],
          isError: true,
        };
      }
      return { content: [{ type: 'text', text: `Todo ${id} deleted.` }] };
    },
  };

  const sendSummaryTool: McpServerTool = {
    name: 'send_summary',
    description: 'Send a summary of pending todos to Telegram channel.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async (): Promise<McpToolResult> => {
      if (!isTelegramConfigured()) {
        return {
          content: [
            { type: 'text', text: 'Telegram not configured (TG_BOT_TOKEN / TG_CHAT_ID).' },
          ],
          isError: true,
        };
      }

      const summary = todoDb.getPendingSummary();
      const rows = todoDb.listTodos('pending');
      if (rows.length === 0) {
        return { content: [{ type: 'text', text: 'No pending todos to send.' }] };
      }

      const result = await publishPost(summary);
      if (!result.ok) {
        return {
          content: [{ type: 'text', text: `Failed to send summary: ${result.error}` }],
          isError: true,
        };
      }

      for (const row of rows) {
        todoDb.markSent(row.id);
      }

      return {
        content: [
          { type: 'text', text: `Summary sent to Telegram (${rows.length} todos).` },
        ],
      };
    },
  };

  const callRemoteToolTool: McpServerTool = {
    name: 'call_remote_tool',
    description: 'Call a tool on the remote Everything MCP server (MCP-to-MCP proxy).',
    inputSchema: {
      type: 'object',
      properties: {
        tool_name: { type: 'string', description: 'Remote tool name' },
        args: {
          type: 'object',
          description: 'Arguments to pass to the remote tool (optional)',
        },
      },
      required: ['tool_name'],
    },
    handler: async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const toolName = args.tool_name;
      if (typeof toolName !== 'string' || toolName.trim().length === 0) {
        return {
          content: [{ type: 'text', text: 'Invalid tool_name: expected a non-empty string.' }],
          isError: true,
        };
      }

      try {
        const toolArgs =
          typeof args.args === 'object' && args.args !== null
            ? (args.args as Record<string, unknown>)
            : undefined;
        const text = await remoteMcp.callTool(toolName, toolArgs);
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Remote tool call failed: ${msg}` }],
          isError: true,
        };
      }
    },
  };

  const listRemoteToolsTool: McpServerTool = {
    name: 'list_remote_tools',
    description: 'List tools available on the remote Everything MCP server.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async (): Promise<McpToolResult> => {
      if (remoteTools.length === 0) {
        return {
          content: [{ type: 'text', text: 'No remote tools available (server may be unreachable).' }],
        };
      }

      const lines = remoteTools.map(
        (t) => `- ${t.name}${t.description ? `: ${t.description}` : ''}`,
      );
      return {
        content: [
          {
            type: 'text',
            text: `Remote tools (${remoteTools.length}):\n${lines.join('\n')}`,
          },
        ],
      };
    },
  };

  // --- Сервер ---

  const server = new McpHttpServer({
    name: 'day-18-todo-server',
    version: '1.0.0',
    tools: [
      addTodoTool,
      listTodosTool,
      completeTodoTool,
      dismissTodoTool,
      deleteTodoTool,
      sendSummaryTool,
      callRemoteToolTool,
      listRemoteToolsTool,
    ],
    port,
  });

  // --- Фоновый цикл: проверка due-задач каждые 60 секунд ---

  const bgTimer = setInterval(async () => {
    try {
      const due = todoDb.getDueTodos();
      if (due.length === 0) return;

      console.error(`[bg] ${due.length} due todo(s) found`);

      const lines = due.map((r) => `- ${r.text} [id=${r.id}]`);
      const summary = `⏰ Due tasks (${due.length}):\n${lines.join('\n')}`;

      if (isTelegramConfigured()) {
        const result = await publishPost(summary);
        if (result.ok) {
          for (const row of due) {
            todoDb.markSent(row.id);
          }
          console.error(`[bg] Sent ${due.length} due todo(s) to Telegram`);
        } else {
          console.error(`[bg] Telegram send failed: ${result.error}`);
        }
      } else {
        console.error(`[bg] Telegram not configured, skipping send`);
        // Still mark sent so we don't reprocess every cycle
        for (const row of due) {
          todoDb.markSent(row.id);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[bg] Error in background cycle: ${msg}`);
    }
  }, BG_INTERVAL_MS);

  // --- Запуск и shutdown ---

  const shutdown = (): void => {
    clearInterval(bgTimer);
    server.stop();
    todoDb.close();
    remoteMcp.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.start();
}
