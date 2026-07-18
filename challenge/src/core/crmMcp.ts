// CRM STDIO-MCP-сервер support-assistant (день 33): два read-only tool'а
// get_user / get_ticket. Постоянная фича → модуль в core/, НЕ в demos/.
// Transport: STDIO (JSON-RPC over stdin/stdout) — нет сети/bind/auth
// (эталон assistantMcp.ts). SQL строго parameterized `?` — SQLi-инвариант
// CLAUDE.md. Tool'ы read-only: description явно фиксирует «не модифицирует».

import { McpStdioServer } from './mcpServer.js';
import type { McpServerTool } from './mcpServer.js';
import { loadEnvUpward } from './env.js';
import { dataPath } from './paths.js';
import { CrmDb } from './crmDb.js';

// CRM-таблицы живут в общем blog.sqlite (решение пользователя). dataPath даёт
// cwd-независимый путь (challenge/.data/blog.sqlite), тот же файл, что DB_PATH в cli.ts.
const CRM_DB_PATH = dataPath('blog.sqlite');

function textResult(obj: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }] };
}

function errResult(msg: string): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return { content: [{ type: 'text', text: JSON.stringify({ found: false, error: msg }) }], isError: true };
}

/** Профиль пользователя по id. Read-only. Возвращает {found, ...} или {found:false}. */
export const getUserTool: McpServerTool = {
  name: 'get_user',
  description:
    'Профиль пользователя CRM по id (name, email, plan, locale, two_fa, created_at). ' +
    'Read-only: не модифицирует данные.',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'integer', minimum: 1 } },
    required: ['id'],
  },
  handler: async (args) => {
    const id = Number(args.id);
    if (!Number.isInteger(id) || id <= 0) {
      return errResult('id must be a positive integer');
    }
    const db = new CrmDb(CRM_DB_PATH);
    try {
      const u = db.getUser(id);
      return u ? textResult({ found: true, ...u }) : textResult({ found: false });
    } finally {
      db.close();
    }
  },
};

/** Тикет по id. Read-only. Возвращает {found, ...} или {found:false}. */
export const getTicketTool: McpServerTool = {
  name: 'get_ticket',
  description:
    'Тикет поддержки CRM по id (user_id, subject, status, priority, details, created_at). ' +
    'Read-only: не модифицирует данные.',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'integer', minimum: 1 } },
    required: ['id'],
  },
  handler: async (args) => {
    const id = Number(args.id);
    if (!Number.isInteger(id) || id <= 0) {
      return errResult('id must be a positive integer');
    }
    const db = new CrmDb(CRM_DB_PATH);
    try {
      const t = db.getTicket(id);
      return t ? textResult({ found: true, ...t }) : textResult({ found: false });
    } finally {
      db.close();
    }
  },
};

export async function runCrmServer(): Promise<void> {
  loadEnvUpward();
  const server = new McpStdioServer({
    name: 'crm-server',
    version: '1.0.0',
    tools: [getUserTool, getTicketTool],
  });
  await server.start();
}
