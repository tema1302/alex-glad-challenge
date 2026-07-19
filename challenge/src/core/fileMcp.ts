// File STDIO-MCP-сервер (день 34): три tool'а file_search / file_read /
// file_write. Постоянная фича → модуль в core/, НЕ в demos/. Transport: STDIO
// (JSON-RPC over stdin/stdout) — нет сети/bind/auth (эталон crmMcp.ts).
//
// Path-confinement defense-in-depth: каждый tool-обработчик сначала
// resolveInside (path-traversal отказ ДО I/O) → isDenylisted → (write)
// assertWriteAllowed. file_search не открывает пути от пользователя вообще
// (ходит только по обходимому дереву, no shell — native node:fs).
//
// .env.example читается/ищется, но значения редуцируются (redactEnvTemplate);
// .env/.env.local/.data/архив в denylist — не возвращаются никогда.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { McpStdioServer } from './mcpServer.js';
import type { McpServerTool } from './mcpServer.js';
import { loadEnvUpward } from './env.js';
import { findRepoRoot } from './rag/docsCorpus.js';
import {
  resolveInside,
  isDenylisted,
  assertWriteAllowed,
  redactEnvTemplate,
  GuardError,
} from './fileGuard.js';
import { clean } from './sanitize.js';

function textResult(obj: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }] };
}

function errResult(msg: string): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return { content: [{ type: 'text', text: JSON.stringify({ error: msg }) }], isError: true };
}

function posixRel(repoRoot: string, abs: string): string {
  return path.relative(repoRoot, abs).split(path.sep).join('/');
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next']);
const TEXT_EXT = new Set(['.md', '.markdown', '.txt', '.json']);
const CODE_EXT = new Set(['.ts', '.js', '.mjs', '.cjs']);
// .env.example/.env.sample — текстовые шаблоны: searchable, но значения редуцируются.
const ENV_TEMPLATE = /^\.env\.(example|sample)$/;

function isSearchable(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return TEXT_EXT.has(ext) || CODE_EXT.has(ext) || ENV_TEMPLATE.test(name);
}

/** Рекурсивный обход текстовых файлов. Skip SKIP_DIRS + denylist (defense-in-depth). */
function walkTextFiles(dir: string, repoRoot: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // сбой доступа — пропуск
  }
  for (const name of entries) {
    const full = path.join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      if (isDenylisted(full, repoRoot).denied) continue; // archive/.data/...
      walkTextFiles(full, repoRoot, out);
      continue;
    }
    if (!isSearchable(name)) continue;
    if (isDenylisted(full, repoRoot).denied) continue; // .env/lockfiles/...
    out.push(full);
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

/** file_search: regex по содержимому текстовых файлов. Read-only, no shell. */
export const fileSearchTool: McpServerTool = {
  name: 'file_search',
  description:
    'Поиск по содержимому текстовых файлов репозитория (regex). Read-only: не модифицирует. ' +
    'Возвращает JSON {matches:[{file,line,text}], truncated, walkedFiles}.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'ECMAScript regex, напр. "LlmClient" или "\\bfetch\\("' },
      ext: { type: 'string', description: 'фильтр по расширению с точкой, напр. ".ts"' },
      maxMatches: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
    },
    required: ['pattern'],
  },
  handler: async (args) => {
    const pattern = String(args.pattern ?? '');
    if (pattern.length === 0) return errResult('pattern обязателен');
    let re: RegExp;
    try {
      re = new RegExp(pattern);
    } catch (e) {
      return errResult(`invalid regex: ${e instanceof Error ? e.message : String(e)}`);
    }
    const ext = args.ext ? String(args.ext) : undefined;
    const maxMatches = clamp(Number(args.maxMatches ?? 50), 1, 200);
    const repoRoot = findRepoRoot(process.cwd());
    const files: string[] = [];
    walkTextFiles(repoRoot, repoRoot, files);
    const matches: Array<{ file: string; line: number; text: string }> = [];
    let truncated = false;
    outer: for (const file of files) {
      if (ext && path.extname(file).toLowerCase() !== ext.toLowerCase()) continue;
      let content: string;
      try {
        content = await readFile(file, 'utf8');
      } catch {
        continue;
      }
      const isEnvTpl = ENV_TEMPLATE.test(path.basename(file));
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          const raw = isEnvTpl ? redactEnvTemplate(lines[i]) : lines[i];
          matches.push({
            file: posixRel(repoRoot, file),
            line: i + 1,
            text: raw.slice(0, 200),
          });
          if (matches.length >= maxMatches) {
            truncated = true;
            break outer;
          }
        }
      }
    }
    return textResult({ matches, truncated, walkedFiles: files.length });
  },
};

/** file_read: чтение файла с нумерацией строк. Read-only. .env.example → redacted. */
export const fileReadTool: McpServerTool = {
  name: 'file_read',
  description:
    'Чтение текстового файла с нумерацией строк (L001:\\t...). Read-only. ' +
    '.env.example отдаётся с <redacted> значениями; .env/.env.local/.data/архив — отказ.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'путь относительно корня репо' },
      maxBytes: { type: 'integer', minimum: 1024, maximum: 65536, default: 32768 },
    },
    required: ['path'],
  },
  handler: async (args) => {
    const rel = String(args.path ?? '');
    const maxBytes = clamp(Number(args.maxBytes ?? 32768), 1024, 65536);
    const repoRoot = findRepoRoot(process.cwd());
    let abs: string;
    try {
      abs = resolveInside(repoRoot, rel);
    } catch (e) {
      return errResult(e instanceof GuardError ? e.message : 'path-traversal');
    }
    const dv = isDenylisted(abs, repoRoot);
    if (dv.denied) return errResult(`denylisted: ${dv.reason}`);
    let content: string;
    try {
      content = await readFile(abs, 'utf8');
    } catch (e) {
      return errResult(`read failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (ENV_TEMPLATE.test(path.basename(abs))) content = redactEnvTemplate(content);
    if (content.length > maxBytes) {
      content = content.slice(0, maxBytes) + '\n…[truncated]…';
    }
    const lines = content.split(/\r?\n/);
    const numbered = lines
      .map((l, i) => `L${String(i + 1).padStart(3, '0')}\t${l}`)
      .join('\n');
    // Сырой текст (не JSON) — потребитель (file-assistant) stripper'ом снимает Lnnn\t.
    return { content: [{ type: 'text', text: numbered }] };
  },
};

/**
 * file_write: полная перезапись файла. Регистрируется только при runFileServer(true).
 *
 * Write-allowlist (assertWriteAllowed): docs (README.md | AGENTS.md | docs-*.md) +
 * code (.ts в challenge/src/, КРОМЕ protected-set: cli, registry, env, client, types,
 * sanitize, assistantMcp, file-любые, mcp-любые, -Mcp-суффикс). Контент sanitize через clean().
 *
 * ВНИМАНИЕ: code-write allowlist — это safety-net НА ВЫЗЫВАЮЩЕЙ СТОРОНЕ (fileAgent.ts:
 * pre-валидация + typecheck-rollback в fileSafety.ts). file_write повторяет guard
 * как defense-in-depth, но НЕ поднимайте file-server --write как долгоживущий сервис
 * — это STDIO-only инструмент для разового round-trip из CLI-агента.
 */
export const fileWriteTool: McpServerTool = {
  name: 'file_write',
  description:
    'Перезаписать файл целиком (full write). Path-confinement + write-allowlist enforced: ' +
    'docs (README.md, AGENTS.md, docs/*.md) + code (.ts в challenge/src/, КРОМЕ protected-set: ' +
    'cli, registry, env, client, types, sanitize, assistantMcp, file-префикс, mcp-префикс, Mcp-суффикс). ' +
    'Контент sanitize через clean(). Code-write safety-net — на вызывающей стороне (fileAgent.ts); ' +
    'не использовать как долгоживущий сервис.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'путь относительно корня репо (write-allowlist)' },
      content: { type: 'string', maxLength: 102400 },
    },
    required: ['path', 'content'],
  },
  handler: async (args) => {
    const rel = String(args.path ?? '');
    const content = String(args.content ?? '');
    if (content.length > 102400) return errResult('content too large (>100KB)');
    const repoRoot = findRepoRoot(process.cwd());
    let abs: string;
    try {
      abs = resolveInside(repoRoot, rel);
    } catch (e) {
      return errResult(e instanceof GuardError ? e.message : 'path-traversal');
    }
    const dv = isDenylisted(abs, repoRoot);
    if (dv.denied) return errResult(`denylisted: ${dv.reason}`);
    try {
      assertWriteAllowed(rel);
    } catch (e) {
      return errResult(e instanceof GuardError ? e.message : 'write-not-allowed');
    }
    const sanitized = clean(content);
    try {
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, sanitized);
    } catch (e) {
      return errResult(`write failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    const relPosix = posixRel(repoRoot, abs);
    const bytes = Buffer.byteLength(sanitized);
    process.stderr.write(`[file-server] WRITE ${relPosix} ${bytes} bytes\n`);
    return textResult({ ok: true, bytes, path: relPosix });
  },
};

/** Поднять STDIO-MCP file-server. Без allowWrite — только read-only tools. */
export async function runFileServer(allowWrite: boolean = false): Promise<void> {
  loadEnvUpward();
  const tools: McpServerTool[] = [fileSearchTool, fileReadTool];
  if (allowWrite) tools.push(fileWriteTool);
  const server = new McpStdioServer({ name: 'file-server', version: '1.0.0', tools });
  await server.start();
}
