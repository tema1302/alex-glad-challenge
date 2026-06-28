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
// Регулярный ежедневный summary: фоновый цикл (каждые 5 мин) проверяет,
// не настал ли час отправки (SUMMARY_HOUR, по умолчанию 9). Если настал и
// сегодня сводка ещё не уходила — отправляет список pending-задач в Telegram
// и фиксирует дату отправки в todo_meta, чтобы не дублировать в тот же день.

import path from 'node:path';
import { McpHttpServer } from '../core/mcpHttpServer.js';
import type { McpServerTool, McpToolResult } from '../core/mcpHttpServer.js';
import { McpHttpClient } from '../core/mcpHttpClient.js';
import { TodoDb } from '../core/todoDb.js';
import { publishPost, isTelegramConfigured } from '../core/agents/telegram.js';
import {
  connectScanClient,
  disconnectScanClient,
  isScanConfigured,
  scanChatMessages,
  analyzeMessages,
  type ScanResult,
} from '../core/agents/telegramScan.js';

const EVERYTHING_SERVER_URL = 'https://everything.mcp.inevitable.fyi/mcp';

/** Кеш последнего скана чата (анализ берёт его, не запрашивая TG повторно). */
let lastScan: ScanResult | null = null;

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

  // --- Инструменты дня 19: пайплайн скана чата (scan → analyze → send) ---

  const scanChatMessagesTool: McpServerTool = {
    name: 'scan_chat_messages',
    description:
      'Scan last N messages from a Telegram chat (step 1: get data). MTProto userbot — needs TG_API_ID/TG_API_HASH/TG_SESSION. chat = @username / numeric id / dialog title.',
    inputSchema: {
      type: 'object',
      properties: {
        chat: { type: 'string', description: 'Chat @username, numeric id, or dialog title to resolve' },
        limit: { type: 'integer', minimum: 1, maximum: 1000, description: 'Recent messages to fetch (default 200)' },
      },
      required: ['chat'],
    },
    handler: async (args: Record<string, unknown>): Promise<McpToolResult> => {
      if (!isScanConfigured()) {
        return {
          content: [{ type: 'text', text: 'Telegram scan not configured (TG_API_ID/TG_API_HASH/TG_SESSION).' }],
          isError: true,
        };
      }
      const chat = args.chat;
      if (typeof chat !== 'string' || chat.trim().length === 0) {
        return { content: [{ type: 'text', text: 'Invalid chat: expected a non-empty string.' }], isError: true };
      }
      const limit =
        typeof args.limit === 'number' && Number.isInteger(args.limit) && args.limit > 0
          ? Math.min(args.limit, 1000)
          : 200;
      try {
        const res = await scanChatMessages(chat, limit);
        lastScan = res;
        const byAuthor = res.messages.reduce<Record<string, number>>((acc, m) => {
          acc[m.from] = (acc[m.from] ?? 0) + 1;
          return acc;
        }, {});
        const top = Object.entries(byAuthor)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([k, v]) => `${k}(${v})`)
          .join(', ');
        return {
          content: [
            {
              type: 'text',
              text: `Сканировано ${res.total} сообщений из «${res.chat}». Топ авторов: ${top || '—'}. Запусти analyze_messages для отчёта.`,
            },
          ],
        };
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `scan failed: ${m}` }], isError: true };
      }
    },
  };

  const analyzeMessagesTool: McpServerTool = {
    name: 'analyze_messages',
    description:
      'Build a deterministic report over the last scanned chat (step 2: process). No LLM — counts senders, top terms, links. Call scan_chat_messages first.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (): Promise<McpToolResult> => {
      if (!lastScan) {
        return {
          content: [{ type: 'text', text: 'Нет данных: сначала вызови scan_chat_messages.' }],
          isError: true,
        };
      }
      return { content: [{ type: 'text', text: analyzeMessages(lastScan) }] };
    },
  };

  const sendToChatTool: McpServerTool = {
    name: 'send_to_chat',
    description:
      'Send a text to the configured Telegram chat (step 3: deliver). Uses TG_BOT_TOKEN/TG_CHAT_ID (Bot API).',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to send' } },
      required: ['text'],
    },
    handler: async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const text = args.text;
      if (typeof text !== 'string' || text.trim().length === 0) {
        return { content: [{ type: 'text', text: 'Invalid text: expected a non-empty string.' }], isError: true };
      }
      if (!isTelegramConfigured()) {
        return { content: [{ type: 'text', text: 'Telegram not configured (TG_BOT_TOKEN / TG_CHAT_ID).' }], isError: true };
      }
      const result = await publishPost(text);
      if (!result.ok) {
        return { content: [{ type: 'text', text: `Failed to send: ${result.error}` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Sent to Telegram (message_id=${result.messageId}).` }] };
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
      scanChatMessagesTool,
      analyzeMessagesTool,
      sendToChatTool,
    ],
    port,
  });

  // --- Регулярный ежедневный summary в Telegram ---

  const SUMMARY_CHECK_MS = 5 * 60_000; // проверка каждые 5 минут
  const parsedHour = Number(process.env.SUMMARY_HOUR);
  const SUMMARY_HOUR =
    Number.isInteger(parsedHour) && parsedHour >= 0 && parsedHour <= 23 ? parsedHour : 9;
  const META_KEY = 'last_daily_summary_date';

  /** Локальная дата YYYY-MM-DD (консистентна с getHours — тоже локальный час). */
  const localDate = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const runDailySummary = async (): Promise<void> => {
    if (!isTelegramConfigured()) return;
    const now = new Date();
    if (now.getHours() < SUMMARY_HOUR) return; // ещё не настал час отправки

    const today = localDate(now);
    if (todoDb.getMeta(META_KEY) === today) return; // сегодня уже отправляли

    const rows = todoDb.listTodos('pending');
    if (rows.length === 0) return; // нечего отправлять — дату не фиксируем, ждём задачи

    const result = await publishPost(todoDb.getPendingSummary());
    if (result.ok) {
      todoDb.setMeta(META_KEY, today);
      console.error(`[daily-summary] Sent ${rows.length} pending todo(s) to Telegram`);
    } else {
      console.error(`[daily-summary] Telegram send failed: ${result.error}`);
    }
  };

  const bgTimer = setInterval(() => {
    void runDailySummary().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[daily-summary] Error: ${msg}`);
    });
  }, SUMMARY_CHECK_MS);
  void runDailySummary(); // сразу при старте — если час уже наступил

  // --- Запуск и shutdown ---

  const shutdown = (): void => {
    clearInterval(bgTimer);
    server.stop();
    todoDb.close();
    remoteMcp.disconnect();
    void disconnectScanClient();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // --- MTProto userbot (день 19): скан истории чата ---
  try {
    const ok = await connectScanClient();
    console.error(
      ok
        ? 'MTProto scan client connected'
        : 'MTProto scan client not configured (TG_API_ID/TG_API_HASH/TG_SESSION) — scan_chat_messages disabled',
    );
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    console.error(`MTProto scan client failed to connect: ${m}`);
  }

  await server.start();
}
