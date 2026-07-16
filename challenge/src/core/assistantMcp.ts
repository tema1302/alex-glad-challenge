// MCP STDIO-сервер dev-assistant с одним read-only tool git_branch.
// Постоянная фича → модуль в core/, НЕ в demos/. Transport: STDIO (JSON-RPC over
// stdin/stdout) — нет сети/bind/auth (см. эталон demos/day-25-server.ts). git_branch
// НЕ вызывается из pipeline dev-assistant — отдельная поверхность (agent-loop
// интеграция = over-engineering для MVP).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { McpStdioServer } from './mcpServer.js';
import type { McpServerTool } from './mcpServer.js';
import { loadEnvUpward } from './env.js';

const execFileP = promisify(execFile);

// Security (command-injection, CLAUDE.md триггер): execFile с МАССИВОМ аргументов,
// shell НЕ true, БЕЗ строковой интерполяции. Zero-arg tool → поверхность тривиальна.
// Allowlist внутри handler: только read-only подкоманды rev-parse/branch.
// cwd = process.cwd(). Запрет exec(string) и shell:true — инъекция невозможна.
export const gitBranchTool: McpServerTool = {
  name: 'git_branch',
  description:
    'Текущая git-ветка и список локальных веток репозитория. Read-only: не модифицирует состояние.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  handler: async () => {
    try {
      const cur = await execFileP('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: process.cwd(),
      });
      const list = await execFileP(
        'git',
        ['branch', '--list', '--format=%(refname:short)'],
        { cwd: process.cwd() },
      );
      const current = cur.stdout.trim();
      const branches = list.stdout
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const text = `current: ${current}\nlocal: [${branches.join(', ')}]`;
      return { content: [{ type: 'text', text }] };
    } catch (e) {
      // Не git-репо / git не установлен → friendly error, не краш сервера.
      const m = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: 'text', text: `git error: ${m.split('\n')[0].slice(0, 200)}` }],
        isError: true,
      };
    }
  },
};

export async function runAssistantServer(): Promise<void> {
  loadEnvUpward();
  const server = new McpStdioServer({
    name: 'dev-assistant',
    version: '1.0.0',
    tools: [gitBranchTool],
  });
  await server.start();
}
