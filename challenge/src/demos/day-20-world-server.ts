// День 20. Внешний MCP-сервер «world»: источник данных вне vault.
//
// Второй сервер оркестрации «Брифинг дня». Даёт агенту доступ к тому, чего в
// Obsidian нет: текущая дата (рулит всем флоу) и произвольный web-fetch
// (результаты матчей, новости, факты). Вместе с obsidian-mcp образует
// кросс-серверный сценарий: часть шагов идёт через vault, часть — через мир.
//
// Инструменты:
//   - get_current_time()   — сегодняшняя дата YYYY-MM-DD + день недели + ISO
//   - fetch_url(url)       — GET текста по URL (встроенный fetch Node 24)

import { McpHttpServer } from '../core/mcpHttpServer.js';
import type { McpServerTool, McpToolResult } from '../core/mcpHttpServer.js';
import { getMcpAuth } from '../core/env.js';

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const FETCH_LIMIT = 4000;

function stamp(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const getCurrentTime: McpServerTool = {
  name: 'get_current_time',
  description: 'Get current local date as YYYY-MM-DD, weekday (Russian) and ISO timestamp.',
  inputSchema: { type: 'object', properties: {} },
  handler: async (): Promise<McpToolResult> => {
    const now = new Date();
    const text = `date: ${stamp(now)}\nweekday: ${WEEKDAYS[now.getDay()]}\niso: ${now.toISOString()}`;
    return { content: [{ type: 'text', text }] };
  },
};

const fetchUrl: McpServerTool = {
  name: 'fetch_url',
  description: 'Fetch text content of a URL (GET). Use for live data: football scores, news, facts. Truncated to keep context small.',
  inputSchema: {
    type: 'object',
    properties: { url: { type: 'string', description: 'Absolute http(s) URL' } },
    required: ['url'],
  },
  handler: async (args: Record<string, unknown>): Promise<McpToolResult> => {
    const url = args.url;
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return { content: [{ type: 'text', text: 'Invalid url: expected an absolute http(s) URL.' }] };
    }
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10_000);
      const resp = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'challenge-day20-fetch/1.0' },
      });
      clearTimeout(timer);
      if (!resp.ok) {
        return { content: [{ type: 'text', text: `HTTP ${resp.status} ${resp.statusText} для ${url}` }] };
      }
      const raw = await resp.text();
      const text = raw.length > FETCH_LIMIT ? `${raw.slice(0, FETCH_LIMIT)}…[обрезано]` : raw;
      return { content: [{ type: 'text', text }] };
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Не удалось загрузить ${url}: ${m}` }] };
    }
  },
};

/** Поднять world-mcp HTTP-сервер на порту port. */
export async function runWorldServer(port: number): Promise<McpHttpServer> {
  const server = new McpHttpServer({
    name: 'world-mcp',
    version: '1.0.0',
    tools: [getCurrentTime, fetchUrl],
    port,
    authToken: getMcpAuth(),
  });
  await server.start();
  return server;
}
