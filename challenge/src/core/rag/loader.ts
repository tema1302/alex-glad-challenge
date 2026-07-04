// Загрузка документов из каталога в текст.
// Поддержка: .md/.markdown/.txt/.json (текст), .ts/.js/.mjs/.cjs (код как текст).
// PDF НЕ поддерживается без сторонней зависимости — сконвертируйте в .txt/.md
// (требование челленджа допускает «эквивалент в коде»).

import { readFile } from 'node:fs/promises';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export interface LoadedDoc {
  source: string;     // путь относительно корня загрузки
  text: string;
}

const TEXT_EXT = new Set(['.md', '.markdown', '.txt', '.json']);
const CODE_EXT = new Set(['.ts', '.js', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build']);

function listFiles(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(`Каталог не существует: ${dir}`);
    }
    return; // иной сбой доступа — пропуск
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
      listFiles(full, out);
      continue;
    }
    const ext = path.extname(name).toLowerCase();
    if (!TEXT_EXT.has(ext) && !CODE_EXT.has(ext)) {
      if (ext === '.pdf') {
        console.warn(`[loader] PDF без dep не читается: ${full} — положите .txt/.md`);
      }
      continue;
    }
    out.push(full);
  }
}

// Нормализация артефактов конвертации PDF→MD в текстовых источниках:
//   1) склеить переносы слов вида "подогре-\nва" → "подогрева" (дефис в конце строки
//      перед переносом, продолжение со строчной буквы);
//   2) удалить строки-ограждения из одних тройных бэктиков (```/```text/...),
//      которыми конвертер оборачивает почти каждую строку.
// К кодовым источникам (.ts/.js/...) НЕ применяется — там fences и дефисы значимы.
function normalizePdfMarkdown(text: string): string {
  return text
    .replace(/([А-Яа-яЁёA-Za-z])-\r?\n([а-яёa-z])/g, '$1$2')
    .replace(/^[ \t]*```[^\n]*\r?\n?/gm, '');
}

export async function loadDocs(rootDir: string): Promise<LoadedDoc[]> {
  const files: string[] = [];
  listFiles(rootDir, files);
  const docs: LoadedDoc[] = [];
  for (const full of files) {
    const raw = await readFile(full, 'utf8');
    const source = path.relative(rootDir, full).split(path.sep).join('/');
    const text = isCodeSource(source) ? raw : normalizePdfMarkdown(raw);
    docs.push({ source, text });
  }
  return docs;
}

export function isCodeSource(source: string): boolean {
  return CODE_EXT.has(path.extname(source).toLowerCase());
}
