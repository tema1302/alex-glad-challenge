// День 17. Standalone MCP HTTP-сервер.
//
// Регистрирует 4 инструмента:
//   - get_user_posts: посты пользователя из JSONPlaceholder API.
//   - get_todos: задачи пользователя из JSONPlaceholder API.
//   - add_note: добавляет заметку в локальный in-memory стор.
//   - list_notes: возвращает все заметки из локального стора.
//
// Сервер запускается ОТДЕЛЬНО от демо-агента (в своём терминале) и слушает
// HTTP-запросы (по умолчанию порт 3001). Демо-агент подключается к нему как
// MCP-клиент по HTTP-транспорту.
//
// Спека MCP: https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle

import { McpHttpServer } from '../core/mcpHttpServer.js';
import type { McpServerTool, McpToolResult } from '../core/mcpHttpServer.js';
import { getMcpAuth } from '../core/env.js';

/** Пост из ответа JSONPlaceholder /posts. */
interface JsonPlaceholderPost {
  id: number;
  title: string;
  body: string;
}

/** Задача из ответа JSONPlaceholder /todos. */
interface JsonPlaceholderTodo {
  id: number;
  title: string;
  completed: boolean;
}

/** Запись в локальном in-memory сторе заметок. */
interface Note {
  id: number;
  text: string;
  createdAt: string;
}

/** In-memory стор заметок и счётчик идентификаторов. */
const notes: Note[] = [];
let nextNoteId = 1;

/** Инструмент get_user_posts: посты пользователя из JSONPlaceholder. */
const getUserPostsTool: McpServerTool = {
  name: 'get_user_posts',
  description: 'Get blog posts by a specific user from JSONPlaceholder API',
  inputSchema: {
    type: 'object',
    properties: {
      userId: {
        type: 'integer',
        minimum: 1,
        description: 'User ID',
      },
    },
    required: ['userId'],
  },
  handler: async (args: Record<string, unknown>): Promise<McpToolResult> => {
    const userId = args.userId;
    if (typeof userId !== 'number' || !Number.isInteger(userId) || userId < 1) {
      return {
        content: [
          { type: 'text', text: 'Invalid userId: expected an integer >= 1.' },
        ],
        isError: true,
      };
    }

    let posts: JsonPlaceholderPost[];
    try {
      const url = `https://jsonplaceholder.typicode.com/posts?userId=${userId}`;
      const resp = await fetch(url);
      if (!resp.ok) {
        return {
          content: [
            {
              type: 'text',
              text: `Request failed: HTTP ${resp.status} ${resp.statusText}`,
            },
          ],
          isError: true,
        };
      }
      posts = (await resp.json()) as JsonPlaceholderPost[];
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Fetch failed: ${message}` }],
        isError: true,
      };
    }

    const lines: string[] = [`Found ${posts.length} post(s) for user ${userId}.`];
    const shown = posts.slice(0, 10);
    shown.forEach((post, idx) => {
      lines.push(`${idx + 1}. ${post.title}`);
    });
    if (posts.length > shown.length) {
      lines.push(`...and ${posts.length - shown.length} more.`);
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
};

/** Инструмент get_todos: задачи пользователя из JSONPlaceholder. */
const getTodosTool: McpServerTool = {
  name: 'get_todos',
  description: 'Get todos for a specific user from JSONPlaceholder API',
  inputSchema: {
    type: 'object',
    properties: {
      userId: {
        type: 'integer',
        minimum: 1,
        description: 'User ID',
      },
    },
    required: ['userId'],
  },
  handler: async (args: Record<string, unknown>): Promise<McpToolResult> => {
    const userId = args.userId;
    if (typeof userId !== 'number' || !Number.isInteger(userId) || userId < 1) {
      return {
        content: [
          { type: 'text', text: 'Invalid userId: expected an integer >= 1.' },
        ],
        isError: true,
      };
    }

    let todos: JsonPlaceholderTodo[];
    try {
      const url = `https://jsonplaceholder.typicode.com/todos?userId=${userId}`;
      const resp = await fetch(url);
      if (!resp.ok) {
        return {
          content: [
            {
              type: 'text',
              text: `Request failed: HTTP ${resp.status} ${resp.statusText}`,
            },
          ],
          isError: true,
        };
      }
      todos = (await resp.json()) as JsonPlaceholderTodo[];
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Fetch failed: ${message}` }],
        isError: true,
      };
    }

    const completedCount = todos.filter((t) => t.completed).length;
    const lines: string[] = [
      `Found ${todos.length} todo(s) for user ${userId}; ${completedCount} completed.`,
    ];
    const shown = todos.slice(0, 5);
    shown.forEach((todo, idx) => {
      const status = todo.completed ? '[x]' : '[ ]';
      lines.push(`${idx + 1}. ${status} ${todo.title}`);
    });
    if (todos.length > shown.length) {
      lines.push(`...and ${todos.length - shown.length} more.`);
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
};

/** Инструмент add_note: добавляет заметку в in-memory стор. */
const addNoteTool: McpServerTool = {
  name: 'add_note',
  description: 'Add a note to the local in-memory notes store',
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Note text',
      },
    },
    required: ['text'],
  },
  handler: async (args: Record<string, unknown>): Promise<McpToolResult> => {
    const text = args.text;
    if (typeof text !== 'string' || text.trim().length === 0) {
      return {
        content: [
          { type: 'text', text: 'Invalid text: expected a non-empty string.' },
        ],
        isError: true,
      };
    }

    const note: Note = {
      id: nextNoteId++,
      text,
      createdAt: new Date().toISOString(),
    };
    notes.push(note);

    return {
      content: [
        { type: 'text', text: `Note added with id ${note.id}: ${note.text}` },
      ],
    };
  },
};

/** Инструмент list_notes: возвращает все заметки из in-memory стора. */
const listNotesTool: McpServerTool = {
  name: 'list_notes',
  description: 'List all notes from the local in-memory notes store',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (): Promise<McpToolResult> => {
    if (notes.length === 0) {
      return { content: [{ type: 'text', text: 'No notes yet' }] };
    }

    const lines = notes.map(
      (note, idx) =>
        `${idx + 1}. [#${note.id}] ${note.text} (at ${note.createdAt})`,
    );

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
};

/**
 * Создаёт и запускает standalone MCP HTTP-сервер challenge-mcp-server.
 * Регистрирует 4 инструмента. Слушает заданный порт (по умолчанию 3001).
 * Отвечает на SIGINT/SIGTERM корректным завершением.
 */
export async function runServer(port = 3001): Promise<void> {
  const server = new McpHttpServer({
    name: 'challenge-mcp-server',
    version: '1.0.0',
    tools: [getUserPostsTool, getTodosTool, addNoteTool, listNotesTool],
    port,
    authToken: getMcpAuth(),
  });

  const shutdown = (): void => {
    server.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.start();
}
