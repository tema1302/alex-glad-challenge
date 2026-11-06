// Commit-шаг loop: настоящий git commit, но в sandbox внутри .data, а не в
// основной репозиторий. Сгенерированный код не должен попадать в историю
// проекта; при этом loop честно проходит commit только после чистого review.
//
// Остаточные секреты (если оба слоя их не поймали) маскируются перед записью в
// sandbox: логи и артефакты не должны содержать сырые значения.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { maskSecrets } from '../gateway/secrets.js';
import { dataPath } from '../paths.js';
import type { CommitInput, CommitResult, Committer, SecurityFinding } from './types.js';

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function findingLine(finding: SecurityFinding): string {
  const where = finding.line === null ? 'line n/a' : `line ${finding.line}`;
  const rec = finding.recommendation ? ` Fix: ${finding.recommendation}` : '';
  return `- [${finding.severity.toUpperCase()}] ${where}: ${finding.title}.${rec}`;
}

function renderReview(input: CommitInput, masked: boolean): string {
  const lines = [
    `# Security review — ${input.task.id}`,
    '',
    `- Task: ${input.task.title}`,
    `- Stack: ${input.task.stack}`,
    `- Attempt: ${input.attempt}`,
    `- Warnings: ${input.warnings.length}`,
    `- Sandbox secrets masked: ${masked ? 'yes' : 'no'}`,
    '',
    `Summary: ${input.review.summary || 'n/a'}`,
    '',
    '## Warnings',
    ...(input.warnings.length > 0 ? input.warnings.map(findingLine) : ['- none']),
    '',
    '## Gateway calls',
    ...input.gatewayCalls.map(
      (c) =>
        `- ${c.stage}: request=${c.requestId ?? 'n/a'} input=${c.input} output=${c.output}` +
        `${c.costUsd === null ? '' : ` cost=$${c.costUsd.toFixed(6)}`}`,
    ),
    '',
  ];
  return lines.join('\n');
}

export interface SandboxCommitterOptions {
  readonly root?: string;
}

export class SandboxCommitter implements Committer {
  private readonly root: string;

  constructor(opts: SandboxCommitterOptions = {}) {
    this.root = opts.root ?? dataPath('security-loop', 'sandbox');
  }

  async commit(input: CommitInput): Promise<CommitResult> {
    const dir = path.join(
      this.root,
      input.runId,
      `${input.task.id}-attempt-${input.attempt}`,
    );
    const message = `security-loop: ${input.task.id} attempt ${input.attempt} (${input.warnings.length} warnings)`;

    try {
      mkdirSync(dir, { recursive: true });
      const safeCode = maskSecrets(input.code);
      const masked = safeCode !== input.code;
      writeFileSync(path.join(dir, path.basename(input.task.fileName)), safeCode, 'utf8');
      writeFileSync(path.join(dir, 'SECURITY_REVIEW.md'), renderReview(input, masked), 'utf8');
      writeFileSync(
        path.join(dir, 'REVIEW.json'),
        `${JSON.stringify(
          {
            task: input.task.id,
            attempt: input.attempt,
            summary: input.review.summary,
            warnings: input.warnings,
            gateway: input.gatewayCalls,
            sandboxSecretsMasked: masked,
          },
          null,
          2,
        )}\n`,
        'utf8',
      );

      git(dir, ['init', '-q']);
      git(dir, ['add', '.']);
      git(dir, [
        '-c',
        'user.name=security-loop',
        '-c',
        'user.email=security-loop@local',
        'commit',
        '-q',
        '-m',
        message,
      ]);
      const sha = git(dir, ['rev-parse', '--short', 'HEAD']).trim();
      // Наружу — cwd-relative путь, без абсолютных локальных путей в логах.
      const relDir = path.relative(process.cwd(), dir).replace(/\\/g, '/');
      return { ok: true, sha, dir: relDir, message };
    } catch {
      return { ok: false, message: 'sandbox git commit failed' };
    }
  }
}

/** Dry-run: фиксирует решение loop, но не создаёт git-репозиторий. */
export class NoopCommitter implements Committer {
  async commit(input: CommitInput): Promise<CommitResult> {
    return {
      ok: true,
      message: `dry-run: ${input.task.id} attempt ${input.attempt}`,
    };
  }
}
