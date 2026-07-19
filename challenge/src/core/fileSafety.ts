// Safety-net для code-write (день 34, fixup): программный typecheck + fs-based
// snapshot/rollback. НЕ git: `git checkout HEAD --` снесёт чужие незакоммиченные
// правки при dirty worktree — поэтому откат через memory-snapshot (fs.readFile
// до write → fs.writeFile / fs.unlink restore).
//
// Контракт withTypecheckRollback:
//   1) pre-flight typecheck (репо уже красный → 'preflight-fail', НЕ наши ошибки)
//   2) snapshotPaths(rels) в память
//   3) writeFn() — MCP file_write (вызывает агент)
//   4) post-typecheck (1 вызов)
//   5) fail → restoreSnapshot + RollbackOutcomeFail
// try/catch/finally гарантирует restore при throw внутри writeFn. SIGINT во время
// транзакции → flag → catch → restore → finally removeListener.
//
// execFile no-shell: массив аргументов, shell не поднимается, строковой
// интерполяции нет — инъекция невозможна.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url)); // src/core/
// ДВА '..' от src/core/ → challenge/ (пакетный корень с tsconfig.json и node_modules).
const CHALLENGE_DIR = path.resolve(HERE, '..', '..');
const TSC_BIN = path.resolve(CHALLENGE_DIR, 'node_modules/typescript/bin/tsc');

type ExecErr = {
  code?: string | number;
  signal?: string;
  killed?: boolean;
  stderr?: string;
  stdout?: string;
  message: string;
};

export type TypecheckResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'typecheck-failed' | 'timed-out' | 'spawn-error';
      exitCode?: number;
      stderr: string;
      timedOut?: boolean;
    };

/**
 * Программный typecheck challenge/ через локальный tsc (no-shell, node напрямую).
 * PASS = resolve (exit 0). FAIL = reject exit≠0 → typecheck-failed. Таймаут/ENOENT
 * помечаются отдельно (инфра-ошибки, не логические провалы типов).
 */
export async function runTypecheck(opts?: { timeoutMs?: number }): Promise<TypecheckResult> {
  const timeoutMs = opts?.timeoutMs ?? 60_000;
  try {
    await execFileP(process.execPath, [TSC_BIN, '--noEmit', '-p', 'tsconfig.json'], {
      cwd: CHALLENGE_DIR,
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { ok: true };
  } catch (e) {
    const err = e as ExecErr;
    if (err.killed || err.signal === 'SIGTERM') {
      return { ok: false, reason: 'timed-out', stderr: stderrOf(err), timedOut: true };
    }
    if (typeof err.code === 'string') {
      // spawn-error (ENOENT и пр.) — code строка, stderr/stdout пустые.
      return { ok: false, reason: 'spawn-error', stderr: (err.message ?? String(e)).slice(0, 4000) };
    }
    return {
      ok: false,
      reason: 'typecheck-failed',
      exitCode: typeof err.code === 'number' ? err.code : undefined,
      stderr: stderrOf(err),
    };
  }
}

function stderrOf(err: ExecErr): string {
  const s = `${err.stderr ?? ''}${err.stdout ?? ''}`.trim();
  return s.slice(0, 4000);
}

export interface SnapshotEntry {
  rel: string;
  abs: string;
  existedBefore: boolean;
  content: string | null;
}
export interface Snapshot {
  entries: SnapshotEntry[];
}

/**
 * Снапшот содержимого файлов в память ДО write. Для существующего файла — его
 * байты; для отсутствующего — existedBefore:false (откат = unlink).
 */
export async function snapshotPaths(repoRoot: string, rels: string[]): Promise<Snapshot> {
  const entries: SnapshotEntry[] = [];
  for (const rel of rels) {
    const abs = path.resolve(repoRoot, rel);
    try {
      const content = await readFile(abs, 'utf8');
      entries.push({ rel, abs, existedBefore: true, content });
    } catch (e) {
      const err = e as { code?: string };
      if (err.code === 'ENOENT') {
        entries.push({ rel, abs, existedBefore: false, content: null });
      } else {
        throw e;
      }
    }
  }
  return { entries };
}

/**
 * Восстановить снапшот: modify → writeFile(orig), create → unlink (ENOENT ignored).
 * Идемпотентен: повторный restore безопасен.
 */
export async function restoreSnapshot(snap: Snapshot): Promise<void> {
  for (const e of snap.entries) {
    if (e.existedBefore) {
      await writeFile(e.abs, e.content ?? '');
    } else {
      try {
        await unlink(e.abs);
      } catch (e2) {
        const err = e2 as { code?: string };
        if (err.code !== 'ENOENT') throw e2; // файла уже нет — ок
      }
    }
  }
}

export type RollbackOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: 'preflight-fail' | 'postcheck-fail' | 'timedout';
      stderr: string;
      restored: boolean;
    };

/**
 * Транзакция: pre-flight → snapshot → writeFn → post-typecheck → restore-on-fail.
 * Любой throw внутри writeFn или post-typecheck → restore + RollbackOutcomeFail.
 * SIGINT во время транзакции помечает interrupted → catch → restore.
 */
export async function withTypecheckRollback(
  repoRoot: string,
  rels: string[],
  writeFn: () => Promise<void>,
  opts?: { timeoutMs?: number; onRestore?: (reason: string) => void },
): Promise<RollbackOutcome> {
  const timeoutMs = opts?.timeoutMs ?? 60_000;

  // 1) pre-flight: репо уже красный → НЕ наши ошибки, abort ДО snapshot.
  const pre = await runTypecheck({ timeoutMs });
  if (!pre.ok) {
    return {
      ok: false,
      reason: pre.reason === 'timed-out' ? 'timedout' : 'preflight-fail',
      stderr: pre.stderr,
      restored: false,
    };
  }

  // 2) snapshot
  const snap = await snapshotPaths(repoRoot, rels);

  // SIGINT handler внутри транзакции: flag → catch → restore.
  let interrupted = false;
  const onSigint = (): void => {
    interrupted = true;
  };
  process.once('SIGINT', onSigint);

  try {
    // 3) writeFn (MCP file_write)
    await writeFn();
    if (interrupted) throw new Error('interrupted (SIGINT)');

    // 4) post-typecheck
    const post = await runTypecheck({ timeoutMs });
    if (interrupted) {
      opts?.onRestore?.('interrupted');
      await restoreSnapshot(snap);
      return { ok: false, reason: 'postcheck-fail', stderr: 'interrupted (SIGINT)', restored: true };
    }
    if (post.ok) return { ok: true };

    // 5) fail → restore
    opts?.onRestore?.(post.reason);
    await restoreSnapshot(snap);
    return {
      ok: false,
      reason: post.reason === 'timed-out' ? 'timedout' : 'postcheck-fail',
      stderr: post.stderr,
      restored: true,
    };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    opts?.onRestore?.('exception');
    try {
      await restoreSnapshot(snap);
    } catch {
      // best-effort restore; рапортуем об исходной ошибке
    }
    return {
      ok: false,
      reason: 'postcheck-fail',
      stderr: m.split('\n')[0].slice(0, 4000),
      restored: true,
    };
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
}
