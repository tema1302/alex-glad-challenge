// Тестовый шаг loop: статический lint/contract runner и runner для реальных
// команд. Android-код в этом окружении не компилируется (нет JDK/SDK), поэтому
// demo использует StaticTestRunner; CommandTestRunner готов для CI/локальных
// проектов, где есть команда тестов.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { maskSecrets } from '../gateway/secrets.js';
import type { CodeTask, TestCheck, TestResult, TestRunner } from './types.js';

function checkBalanced(code: string): { ok: boolean; detail?: string } {
  const stack: string[] = [];
  let state: 'normal' | 'line' | 'block' | 'string' = 'normal';
  let quote = '';
  let triple = false;
  let i = 0;

  while (i < code.length) {
    const ch = code[i] ?? '';
    const next = code[i + 1] ?? '';

    if (state === 'line') {
      if (ch === '\n') state = 'normal';
      i += 1;
      continue;
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') {
        state = 'normal';
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }
    if (state === 'string') {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (triple) {
        if (code.slice(i, i + 3) === '"""') {
          state = 'normal';
          triple = false;
          i += 3;
        } else {
          i += 1;
        }
        continue;
      }
      if (ch === quote) {
        state = 'normal';
        quote = '';
      }
      i += 1;
      continue;
    }

    if (ch === '/' && next === '/') {
      state = 'line';
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      state = 'block';
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      if (ch === '"' && code.slice(i, i + 3) === '"""') {
        state = 'string';
        triple = true;
        quote = '"';
        i += 3;
        continue;
      }
      state = 'string';
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      stack.push(ch);
      i += 1;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      const expected = ch === ')' ? '(' : ch === ']' ? '[' : '{';
      const open = stack.pop();
      if (open !== expected) {
        return { ok: false, detail: `unexpected ${ch} at offset ${i}` };
      }
      i += 1;
      continue;
    }
    i += 1;
  }

  if (state === 'block') return { ok: false, detail: 'unterminated block comment' };
  if (state === 'string') return { ok: false, detail: 'unterminated string' };
  if (stack.length > 0) return { ok: false, detail: `unclosed ${stack[stack.length - 1]}` };
  return { ok: true };
}

/** Детерминированный lint/contract runner для demo без JDK/SDK. */
export class StaticTestRunner implements TestRunner {
  async run(code: string, task: CodeTask): Promise<TestResult> {
    const checks: TestCheck[] = [];
    checks.push({ name: 'non-empty', ok: code.trim().length > 0 });
    checks.push({
      name: 'no-markdown-fence',
      ok: !code.includes('```'),
    });

    const balance = checkBalanced(code);
    checks.push({
      name: 'balanced-delimiters',
      ok: balance.ok,
      ...(balance.detail ? { detail: balance.detail } : {}),
    });

    const placeholders = code.match(/\b(TODO|FIXME|YOUR_[A-Z_]+|CHANGE_ME)\b/);
    checks.push({
      name: 'no-placeholders',
      ok: !placeholders,
      ...(placeholders ? { detail: `placeholder: ${placeholders[0]}` } : {}),
    });

    for (const pattern of task.requiredPatterns) {
      pattern.re.lastIndex = 0;
      const ok = pattern.re.test(code);
      checks.push({
        name: `contract:${pattern.label}`,
        ok,
        ...(ok ? {} : { detail: `pattern not found: ${pattern.re.source}` }),
      });
    }

    return { ok: checks.every((c) => c.ok), checks };
  }
}

export interface CommandTestRunnerOptions {
  readonly command: string;
  /** Аргументы; `{file}` заменяется на путь к записанному коду. */
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs?: number;
}

/** Запускает реальную команду над сгенерированным файлом (lint/test/build). */
export class CommandTestRunner implements TestRunner {
  private readonly command: string;
  private readonly args: readonly string[];
  private readonly cwd: string | undefined;
  private readonly timeoutMs: number;

  constructor(opts: CommandTestRunnerOptions) {
    this.command = opts.command;
    this.args = opts.args ?? [];
    this.cwd = opts.cwd;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
  }

  async run(code: string, task: CodeTask): Promise<TestResult> {
    const dir = mkdtempSync(path.join(tmpdir(), 'sec-loop-'));
    const file = path.join(dir, path.basename(task.fileName));
    writeFileSync(file, code, 'utf8');
    const args = (this.args.length > 0 ? this.args : ['{file}']).map((a) =>
      a.replace('{file}', file),
    );

    try {
      execFileSync(this.command, args, {
        cwd: this.cwd ?? dir,
        encoding: 'utf8',
        timeout: this.timeoutMs,
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 1_000_000,
      });
      return {
        ok: true,
        checks: [{ name: `command:${this.command}`, ok: true }],
      };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      const raw = `${e.stdout ?? ''}\n${e.stderr ?? ''}`.trim() || e.message || 'command failed';
      const detail = maskSecrets(raw).replace(/\s+/g, ' ').slice(0, 500);
      return {
        ok: false,
        checks: [{ name: `command:${this.command}`, ok: false, detail }],
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
