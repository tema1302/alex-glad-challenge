// День 20. Obsidian-style MCP-сервер поверх папки vault (markdown-файлы).
//
// Подход через filesystem — без плагина Obsidian и без Local REST API: vault это
// просто каталог .md-файлов. Этот сервер — центральный источник и приёмник
// данных в оркестрации «Брифинг дня»: агент читает заметки, ищет по ним и
// пишет готовый брифинг обратно.
//
// Инструменты:
//   - read_note(name)        — прочитать заметку по имени (с/без .md, с подпапкой)
//   - search_notes(query)    — поиск по тексту всех заметок, возврат совпадений
//   - create_note(name,text) — записать новую заметку в vault

import { promises as fs } from 'node:fs';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { McpHttpServer } from '../core/mcpHttpServer.js';
import type { McpServerTool, McpToolResult } from '../core/mcpHttpServer.js';

export const DEFAULT_VAULT_DIR = process.env.OBSIDIAN_VAULT_DIR ?? path.join(process.cwd(), '.data', 'vault');

const MAX_SEARCH_HITS = 20;

/** Безопасный путь к заметке внутри vault (защита от выхода за пределы каталога). */
function notePath(vaultDir: string, name: string): string {
  const clean = name.replace(/^[/\\]+/, '');
  const base = clean.endsWith('.md') ? clean : `${clean}.md`;
  const resolved = path.resolve(vaultDir, base);
  if (!resolved.startsWith(path.resolve(vaultDir))) {
    throw new Error('Путь за пределами vault');
  }
  return resolved;
}

/** Рекурсивно собрать все .md-файлы vault. */
async function listMarkdown(root: string): Promise<string[]> {
  const out: string[] = [];
  let entries: Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      out.push(...(await listMarkdown(full)));
    } else if (e.isFile() && e.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

function buildTools(vaultDir: string): McpServerTool[] {
  const readNote: McpServerTool = {
    name: 'read_note',
    description: 'Read a markdown note from the Obsidian vault by name (e.g. "2026-06-28" or "team/sprint"); .md optional.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Note name' } },
      required: ['name'],
    },
    handler: async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const name = args.name;
      if (typeof name !== 'string' || name.trim().length === 0) {
        return { content: [{ type: 'text', text: 'Invalid name: expected a non-empty string.' }], isError: true };
      }
      try {
        const text = await fs.readFile(notePath(vaultDir, name), 'utf8');
        return { content: [{ type: 'text', text }] };
      } catch {
        return { content: [{ type: 'text', text: `Заметка «${name}» не найдена.` }], isError: true };
      }
    },
  };

  const searchNotes: McpServerTool = {
    name: 'search_notes',
    description: 'Search all vault notes for query tokens (case-insensitive, OR). Returns "file: matched line" hits.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Space-separated search tokens' } },
      required: ['query'],
    },
    handler: async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const query = args.query;
      if (typeof query !== 'string' || query.trim().length === 0) {
        return { content: [{ type: 'text', text: 'Invalid query: expected a non-empty string.' }], isError: true };
      }
      const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
      const files = await listMarkdown(vaultDir);
      const hits: string[] = [];
      for (const file of files) {
        const rel = path.relative(vaultDir, file).replace(/\\/g, '/');
        let text: string;
        try {
          text = await fs.readFile(file, 'utf8');
        } catch {
          continue;
        }
        for (const line of text.split('\n')) {
          const lower = line.toLowerCase();
          if (tokens.some((t) => lower.includes(t))) {
            const trimmed = line.trim();
            if (trimmed) hits.push(`${rel}: ${trimmed}`);
          }
          if (hits.length >= MAX_SEARCH_HITS) break;
        }
        if (hits.length >= MAX_SEARCH_HITS) break;
      }
      if (hits.length === 0) {
        return { content: [{ type: 'text', text: `Ничего не найдено по запросу «${query}».` }] };
      }
      return { content: [{ type: 'text', text: hits.join('\n') }] };
    },
  };

  const createNote: McpServerTool = {
    name: 'create_note',
    description: 'Create (or overwrite) a markdown note in the vault with the given text.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Note name (no .md needed)' },
        content: { type: 'string', description: 'Full markdown content' },
      },
      required: ['name', 'content'],
    },
    handler: async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const name = args.name;
      const content = args.content;
      if (typeof name !== 'string' || name.trim().length === 0) {
        return { content: [{ type: 'text', text: 'Invalid name.' }], isError: true };
      }
      if (typeof content !== 'string') {
        return { content: [{ type: 'text', text: 'Invalid content.' }], isError: true };
      }
      const full = notePath(vaultDir, name);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content, 'utf8');
      const rel = path.relative(vaultDir, full).replace(/\\/g, '/');
      return { content: [{ type: 'text', text: `Заметка сохранена: ${rel} (${content.length} символов).` }] };
    },
  };

  return [readNote, searchNotes, createNote];
}

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

/** YYYY-MM-DD по локальному времени (совместимо с get_current_time в world-mcp). */
export function localDateStamp(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Гарантирует, что в vault есть демо-заметки. Ежедневная заметка на сегодня
 * пересоздаётся каждый прогон (чтобы агент всегда находил её по текущей дате);
 * остальные — только если отсутствуют (не затирают пользовательские правки).
 */
export async function ensureVaultSeeded(vaultDir: string = DEFAULT_VAULT_DIR): Promise<void> {
  await fs.mkdir(vaultDir, { recursive: true });

  const today = localDateStamp(new Date());
  const weekday = WEEKDAYS[new Date().getDay()];

  const dailyNote = `# ${today} (${weekday})

## Работа
- Ревью PR у команды (Аня — бэкенд, Игорь — фронт)
- Синк с продуктом в 12:00
- 1:1 с разработчиком в 15:30
- Доделать черновик поста про MCP-оркестрацию

## Семья
- Забрать ребёнка из сада в 18:00
- Купить продукты на ужин
- Записать ребёнка к врачу

## Футбол
- Болею за Спартак — посмотреть сегодня матч
`;

  const sprintNote = `# Текущий спринт

- Команда: Аня (бэкенд), Игорь (фронт), Катя (QA)
- Цель спринта: релиз модуля авторизации
- Блокер: жду ответ от DevOps по стейджингу
- Релиз в пятницу
`;

  const listsNote = `# Личные списки

## Быт
- Оплатить квартиру до 5 числа
- Купить подарок ребёнку на День рождения

## Идеи постов
- Как тимлиду не выгореть с маленьким ребёнком
- MCP-оркестрация на коленке за вечер
`;

  // Ежедневная — всегда свежая (по сегодняшней дате).
  await fs.writeFile(path.join(vaultDir, `${today}.md`), dailyNote, 'utf8');

  // Остальные — только если ещё нет.
  const persistent: Record<string, string> = {
    'team/current-sprint.md': sprintNote,
    'personal/lists.md': listsNote,
  };
  for (const [rel, content] of Object.entries(persistent)) {
    const full = path.join(vaultDir, rel);
    try {
      await fs.access(full);
    } catch {
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content, 'utf8');
    }
  }
}

/** Поднять obsidian-mcp HTTP-сервер на порту port. Каталог vault только создаётся
 *  (если нет) — сервер НЕ фабрикует заметки. Сид-данные — отдельная команда
 *  `seed-vault` (опционально, для локальной отладки). */
export async function runObsidianServer(
  port: number,
  vaultDir: string = DEFAULT_VAULT_DIR,
): Promise<McpHttpServer> {
  await fs.mkdir(vaultDir, { recursive: true });
  const server = new McpHttpServer({
    name: 'obsidian-mcp',
    version: '1.0.0',
    tools: buildTools(vaultDir),
    port,
  });
  await server.start();
  return server;
}
