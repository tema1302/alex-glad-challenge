// Файловый guard (день 34): чистые функции path-confinement + denylist +
// write-allowlist + target-resolution для file-server и file-assistant.
// Без side-effects, без I/O — тривиальны для умственной проверки и
// переиспользуются из fileMcp.ts (tool-handler'ы) и fileAssistant.ts (CLI).
// Одна политика в одном месте; defense-in-depth: tool проверяет И CLI проверяет.

import path from 'node:path';

/** Ошибка guard — пробрасывается до CLI, где отображается и даёт ненулевой exit. */
export class GuardError extends Error {
  readonly code: 'path-traversal' | 'denylisted' | 'write-not-allowed';
  constructor(code: 'path-traversal' | 'denylisted' | 'write-not-allowed', message?: string) {
    super(message ?? code);
    this.name = 'GuardError';
    this.code = code;
  }
}

export type DenyVerdict =
  | { denied: false }
  | {
      denied: true;
      reason: 'env-secret' | 'data' | 'vcs' | 'build' | 'archive' | 'lockfile' | 'node_modules';
    };

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/**
 * Абсолютный путь файла внутри repoRoot. Бросает GuardError('path-traversal')
 * при выходе за границы (rel начинается с '..' после resolve, либо abs/rel
 * абсолютный — включая Windows cross-drive). Запрос '../../.env' → отказ ДО I/O.
 */
export function resolveInside(repoRoot: string, rel: string): string {
  if (path.isAbsolute(rel)) {
    throw new GuardError('path-traversal', `абсолютный путь запрещён: ${rel}`);
  }
  const abs = path.resolve(repoRoot, rel);
  const r = path.relative(repoRoot, abs);
  if (r.startsWith('..') || path.isAbsolute(r)) {
    throw new GuardError('path-traversal', `путь за пределами репо: ${rel}`);
  }
  return abs;
}

/**
 * Verdict по denylist (всегда отказ, даже под --write). Сегментный матч по
 * POSIX rel. Замороженный архив 1-day..10-day защищён отдельной категорией.
 */
export function isDenylisted(abs: string, repoRoot: string): DenyVerdict {
  const rel = toPosix(path.relative(repoRoot, abs));
  // env-secret: .env, .env.local, .env.*.local, .env.production, .env.development
  // (НЕ .env.example — он нужен как шаблон с <redacted> значениями).
  if (
    rel === '.env' ||
    rel === '.env.local' ||
    rel === '.env.production' ||
    rel === '.env.development' ||
    /^\.env\.[^\/]*\.local$/.test(rel)
  ) {
    return { denied: true, reason: 'env-secret' };
  }
  const seg = rel.split('/');
  if (seg.includes('node_modules')) return { denied: true, reason: 'node_modules' };
  if (seg.includes('.git')) return { denied: true, reason: 'vcs' };
  if (seg.includes('1-day..10-day')) return { denied: true, reason: 'archive' };
  if (seg.includes('dist') || seg.includes('build') || seg.includes('.next')) {
    return { denied: true, reason: 'build' };
  }
  if (/\.tsbuildinfo$/.test(rel)) return { denied: true, reason: 'build' };
  if (rel === 'challenge/.data' || rel.startsWith('challenge/.data/')) {
    return { denied: true, reason: 'data' };
  }
  if (rel === 'web/.data' || rel.startsWith('web/.data/')) {
    return { denied: true, reason: 'data' };
  }
  if (
    rel === 'pnpm-lock.yaml' ||
    rel === 'package-lock.json' ||
    rel.endsWith('/pnpm-lock.yaml') ||
    rel.endsWith('/package-lock.json')
  ) {
    return { denied: true, reason: 'lockfile' };
  }
  return { denied: false };
}

/**
 * Write-allowlist: только docs-цели. Бросает GuardError('write-not-allowed').
 * Расширение «код» (файлы .ts в challenge/src/core) — default OFF; оставить
 * закомментированным хуком, НЕ активировать в MVP.
 */
export function assertWriteAllowed(rel: string): void {
  const p = toPosix(rel).replace(/^\.\//, '');
  if (p === 'README.md' || p === 'AGENTS.md') return;
  if (p.startsWith('docs/') && p.endsWith('.md')) return;
  // MVP: код не правится. Расширение:
  // if (p.startsWith('challenge/src/core/') && p.endsWith('.ts')) return;
  throw new GuardError(
    'write-not-allowed',
    `запись вне allowlist (допустимы README.md | AGENTS.md | docs/*.md): ${p}`,
  );
}

/**
 * Map цели пользователя → rel-путь target-doc внутри write-allowlist.
 * Детерминировано. Path-traversal через crafted goal невозможен: char-class
 * docs/пути не содержит '.', '..' не пройдёт (см. Addendum A плана).
 */
export function resolveDocTarget(
  goal: string,
): { relPath: string } | { error: string } {
  if (/readme|описание|intro|введение/i.test(goal)) return { relPath: 'README.md' };
  if (/agents|инструкци/i.test(goal)) return { relPath: 'AGENTS.md' };
  const m = goal.match(/docs\/[A-Za-z0-9_\-\/]+\.md/i);
  if (m) return { relPath: m[0] };
  return {
    error:
      'не удалось определить target-doc из goal; уточните: README.md | AGENTS.md | docs/<file>.md',
  };
}

/**
 * Заменяет значения IDENTIFIER=... на <redacted> в содержимом .env-шаблона.
 * Комментарии/пустые строки/пустые значения не трогает. Построчно (/gm).
 */
export function redactEnvTemplate(content: string): string {
  return content.replace(/^([A-Za-z_][A-Za-z0-9_]*)=.+$/gm, '$1=<redacted>');
}
