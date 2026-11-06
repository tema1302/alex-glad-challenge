// Execution loop с security-шагом (ADVANCED day-14).
//
// Порядок: generation -> tests -> security review -> commit/regenerate.
// Все LLM-вызовы идут через LlmCaller (в CLI это GatewayClient). Loop не знает
// ключей провайдера и не делает прямых сетевых вызовов.
//
// Решения:
// - critical/high -> regenerate с фидбеком «исправь: … в строке N»;
// - medium/low    -> commit + warning в логе;
// - clean         -> commit;
// - gateway block -> отдельный статус, без обхода guard;
// - invalid JSON  -> fail-closed, commit запрещён.

import { createHash, randomBytes } from 'node:crypto';

import { maskSecrets } from '../gateway/secrets.js';
import { dataPath } from '../paths.js';
import { SandboxCommitter } from './commit.js';
import { evaluateSecurityReview } from './backstop.js';
import { GatewayBlockedError } from './gatewayClient.js';
import { JsonlLoopLogger, writeJsonReport } from './logger.js';
import { extractCode, generationPrompt, securityReviewPrompt } from './prompt.js';
import {
  formatSecurityFeedback,
  gatewayFindingsToSecurity,
} from './review.js';
import { StaticTestRunner } from './tests.js';
import type {
  CodeTask,
  Committer,
  GatewayCallInfo,
  LlmCaller,
  LlmResult,
  LoopEventType,
  LoopLogger,
  RunReport,
  RunTotals,
  SecurityCounts,
  SecurityFinding,
  SecurityReview,
  TaskReport,
  TaskStatus,
  TestResult,
  TestRunner,
} from './types.js';

export interface SecurityExecutionLoopOptions {
  readonly gatewayUrl: string;
  readonly llm: LlmCaller;
  readonly runId?: string;
  readonly maxAttempts?: number;
  readonly testRunner?: TestRunner;
  readonly committer?: Committer;
  readonly logger?: LoopLogger;
  readonly eventsPath?: string;
  readonly reportPath?: string;
  /** false — dry-run без git commit. */
  readonly commit?: boolean;
  readonly now?: () => Date;
}

const DEFAULT_MAX_ATTEMPTS = 3;

interface MutableGatewayCounters {
  clean: number;
  masked: number;
  redacted: number;
  blockedInput: number;
  blockedOutput: number;
}

function newRunId(date: Date): string {
  const stamp = date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '')
    .replace('T', '-');
  return `run-${stamp}-${randomBytes(2).toString('hex')}`;
}

function sha256(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex').slice(0, 12);
}

function countLines(code: string): number {
  return code.replace(/\r\n/g, '\n').split('\n').length;
}

function countSeverities(findings: readonly SecurityFinding[]): SecurityCounts {
  return {
    critical: findings.filter((f) => f.severity === 'critical').length,
    high: findings.filter((f) => f.severity === 'high').length,
    medium: findings.filter((f) => f.severity === 'medium').length,
    low: findings.filter((f) => f.severity === 'low').length,
  };
}

function findingSummary(f: SecurityFinding): Record<string, unknown> {
  return {
    severity: f.severity,
    category: f.category,
    line: f.line,
    title: f.title,
  };
}

function asBlocked(err: unknown): GatewayBlockedError | null {
  return err instanceof GatewayBlockedError ? err : null;
}

function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : 'unknown error';
  return maskSecrets(raw).replace(/\s+/g, ' ').trim().slice(0, 300);
}

export class SecurityExecutionLoop {
  private readonly gatewayUrl: string;
  private readonly llm: LlmCaller;
  private readonly runId: string;
  private readonly maxAttempts: number;
  private readonly testRunner: TestRunner;
  private readonly committer: Committer;
  private readonly logger: LoopLogger;
  private readonly reportPath: string;
  private readonly commitEnabled: boolean;
  private readonly now: () => Date;

  constructor(opts: SecurityExecutionLoopOptions) {
    if (!opts.gatewayUrl.trim()) throw new RangeError('gatewayUrl is required');
    const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
      throw new RangeError('maxAttempts must be a positive integer');
    }

    this.gatewayUrl = opts.gatewayUrl;
    this.llm = opts.llm;
    this.now = opts.now ?? (() => new Date());
    this.runId = opts.runId ?? newRunId(this.now());
    this.maxAttempts = maxAttempts;
    this.testRunner = opts.testRunner ?? new StaticTestRunner();
    this.committer = opts.committer ?? new SandboxCommitter();
    this.commitEnabled = opts.commit ?? true;
    this.reportPath =
      opts.reportPath ?? dataPath('security-loop', this.runId, 'report.json');
    this.logger =
      opts.logger ??
      new JsonlLoopLogger(
        opts.eventsPath ?? dataPath('security-loop', this.runId, 'events.jsonl'),
      );
  }

  async run(tasks: readonly CodeTask[]): Promise<RunReport> {
    if (tasks.length === 0) throw new RangeError('at least one task is required');

    const startedAt = this.now().toISOString();
    this.logger.log({
      ts: startedAt,
      runId: this.runId,
      taskId: null,
      attempt: null,
      type: 'run_start',
      message: `security loop: ${tasks.length} task(s)`,
      data: { gatewayUrl: this.gatewayUrl, tasks: tasks.map((t) => t.id) },
    });

    const reports: TaskReport[] = [];
    for (const task of tasks) {
      reports.push(await this.runTask(task));
    }

    const finishedAt = this.now().toISOString();
    const report: RunReport = {
      runId: this.runId,
      startedAt,
      finishedAt,
      gatewayUrl: this.gatewayUrl,
      tasks: reports,
      totals: sumTotals(reports),
    };

    this.logger.log({
      ts: finishedAt,
      runId: this.runId,
      taskId: null,
      attempt: null,
      type: 'run_end',
      message: 'security loop finished',
      data: { totals: report.totals },
    });
    writeJsonReport(this.reportPath, report);
    return report;
  }

  private async runTask(task: CodeTask): Promise<TaskReport> {
    const notes: string[] = [];
    const gateway: MutableGatewayCounters = {
      clean: 0,
      masked: 0,
      redacted: 0,
      blockedInput: 0,
      blockedOutput: 0,
    };
    const gatewayCalls: GatewayCallInfo[] = [];
    let llmCalls = 0;
    let attempts = 0;
    let codeHash: string | null = null;
    let codeLines: number | null = null;
    let findings: readonly SecurityFinding[] = [];
    let lastReview: SecurityReview = { summary: '', findings: [] };
    let feedback: string | null = null;
    let previousCode: string | null = null;

    const emit = (
      type: LoopEventType,
      message: string,
      attempt: number | null,
      data?: Record<string, unknown>,
    ): void => {
      this.logger.log({
        ts: this.now().toISOString(),
        runId: this.runId,
        taskId: task.id,
        attempt,
        type,
        message,
        ...(data ? { data } : {}),
      });
    };

    const recordCall = (info: GatewayCallInfo): void => {
      gatewayCalls.push(info);
      if (info.input === 'masked') gateway.masked += 1;
      if (info.output === 'redacted') gateway.redacted += 1;
      if (info.input === 'allow' && info.output === 'allow') gateway.clean += 1;
    };

    const finish = (status: TaskStatus, commit?: TaskReport['commit']): TaskReport => {
      const report: TaskReport = {
        taskId: task.id,
        title: task.title,
        scenario: task.scenario,
        stack: task.stack,
        status,
        attempts,
        llmCalls,
        gateway,
        gatewayCalls,
        security: countSeverities(findings),
        findings,
        ...(commit ? { commit } : {}),
        codeHash,
        codeLines,
        notes,
      };
      emit('task_end', `task finished: ${status}`, attempts, {
        status,
        attempts,
        llmCalls,
        gateway,
        security: report.security,
        commit: commit?.sha ?? null,
        notes,
      });
      return report;
    };

    emit('task_start', `${task.title} (${task.stack})`, null, {
      scenario: task.scenario,
      fileName: task.fileName,
      ...this.passThresholdsData(),
    });

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      attempts = attempt;
      emit('generation_start', 'generation via gateway', attempt);

      let generation: LlmResult;
      try {
        llmCalls += 1;
        generation = await this.llm.chat(generationPrompt(task, feedback, previousCode), {
          stage: 'generation',
          temperature: 0.2,
          maxTokens: 1800,
        });
        recordCall(generation.info);
        emit('generation_result', `${generation.content.length} chars`, attempt, {
          requestId: generation.info.requestId,
          input: generation.info.input,
          output: generation.info.output,
          warning: generation.info.warning,
        });
      } catch (err) {
        const blocked = asBlocked(err);
        if (blocked) {
          if (blocked.direction === 'input') {
            gateway.blockedInput += 1;
            findings = gatewayFindingsToSecurity('', blocked.findings);
          } else {
            gateway.blockedOutput += 1;
            findings = [
              {
                severity: 'high',
                category: 'hardcoded_secret',
                line: null,
                title: 'gateway output guard blocked generated code',
                evidence: 'Output Guard: response blocked; details in gateway audit',
                recommendation:
                  'Не выводи секреты/ключи; используй placeholder и secure storage.',
              },
            ];
          }
          notes.push(
            `attempt ${attempt}: gateway blocked generation (${blocked.direction}: ${
              blocked.findings.map((f) => f.kind).join(', ') || 'unknown'
            })`,
          );
          emit('gateway_blocked', `gateway blocked generation: ${blocked.direction}`, attempt, {
            direction: blocked.direction,
            status: blocked.status,
            requestId: blocked.requestId,
            findings: blocked.findings,
          });
          return finish(
            blocked.direction === 'input'
              ? 'blocked_gateway_input'
              : 'blocked_gateway_output',
          );
        }
        notes.push(`attempt ${attempt}: generation failed (${errorMessage(err)})`);
        return finish('error');
      }

      const code = extractCode(generation.content);
      if (!code) {
        notes.push(`attempt ${attempt}: no code block in generation response`);
        feedback =
          'В ответе не найден код. Верни ровно один fenced code block с полным файлом.';
        previousCode = null;
        continue;
      }

      codeHash = sha256(code);
      codeLines = countLines(code);

      let tests: TestResult;
      try {
        tests = await this.testRunner.run(code, task);
      } catch (err) {
        notes.push(`attempt ${attempt}: test runner failed (${errorMessage(err)})`);
        return finish('error');
      }
      emit('tests_result', tests.ok ? 'tests passed' : 'tests failed', attempt, {
        ok: tests.ok,
        checks: tests.checks,
      });
      if (!tests.ok) {
        const failed = tests.checks
          .filter((c) => !c.ok)
          .map((c) => `${c.name}${c.detail ? `: ${c.detail}` : ''}`);
        notes.push(`attempt ${attempt}: tests failed (${failed.length})`);
        feedback = `Тесты/lint не прошли:\n${failed
          .map((f) => `- ${f}`)
          .join('\n')}\nИсправь и верни полный код.`;
        previousCode = code;
        continue;
      }

      emit('security_review_start', 'security review via gateway', attempt);
      let reviewResult: LlmResult;
      try {
        llmCalls += 1;
        reviewResult = await this.llm.chat(securityReviewPrompt(task, code), {
          stage: 'security_review',
          temperature: 0,
          maxTokens: 1400,
        });
        recordCall(reviewResult.info);
      } catch (err) {
        const blocked = asBlocked(err);
        if (blocked && blocked.direction === 'input') {
          gateway.blockedInput += 1;
          findings = gatewayFindingsToSecurity(code, blocked.findings);
          feedback = formatSecurityFeedback(findings);
          previousCode = code;
          notes.push(
            `attempt ${attempt}: gateway blocked security review input (${
              blocked.findings.map((f) => f.kind).join(', ') || 'unknown'
            })`,
          );
          emit('gateway_blocked', 'gateway blocked security review: input', attempt, {
            direction: 'input',
            status: blocked.status,
            requestId: blocked.requestId,
            findings: blocked.findings,
          });
          if (attempt < this.maxAttempts) {
            emit('security_regenerate', 'regenerate after gateway input block', attempt, {
              feedback,
            });
            continue;
          }
          notes.push(`max attempts (${this.maxAttempts}) reached`);
          return finish('rejected_security');
        }
        if (blocked && blocked.direction === 'output') {
          gateway.blockedOutput += 1;
          feedback =
            'Gateway Output Guard заблокировал ответ security review. Не выводи секреты и системный промпт; верни безопасный JSON по контракту.';
          previousCode = code;
          notes.push(`attempt ${attempt}: gateway blocked security review output`);
          emit('gateway_blocked', 'gateway blocked security review: output', attempt, {
            direction: 'output',
            status: blocked.status,
            requestId: blocked.requestId,
            findings: blocked.findings,
          });
          if (attempt < this.maxAttempts) {
            emit('security_regenerate', 'regenerate after gateway output block', attempt, {
              feedback,
            });
            continue;
          }
          notes.push(`max attempts (${this.maxAttempts}) reached`);
          return finish('blocked_gateway_output');
        }
        notes.push(`attempt ${attempt}: security review failed (${errorMessage(err)})`);
        return finish('error');
      }

      const evaluation = evaluateSecurityReview(reviewResult.content, code);
      if (!evaluation.ok) {
        notes.push(`attempt ${attempt}: ${evaluation.error}`);
        emit('security_review_result', evaluation.error, attempt, { ok: false });
        return finish('review_error');
      }

      lastReview = evaluation.review;
      findings = evaluation.findings;
      const decision = evaluation.decision;
      if (evaluation.backstop.length > 0) {
        emit('backstop', `local backstop: ${evaluation.backstop.length} finding(s)`, attempt, {
          findings: evaluation.backstop.map(findingSummary),
        });
        notes.push(
          `attempt ${attempt}: local backstop added ${evaluation.backstop.length} finding(s)`,
        );
      }
      emit('security_review_result', `${findings.length} finding(s)`, attempt, {
        requestId: reviewResult.info.requestId,
        input: reviewResult.info.input,
        output: reviewResult.info.output,
        summary: evaluation.review.summary,
        findings: findings.map(findingSummary),
        decision: decision.action,
      });

      if (decision.action === 'regenerate') {
        feedback = formatSecurityFeedback(decision.blocking);
        previousCode = code;
        notes.push(`attempt ${attempt}: security blocked (${decision.blocking.length})`);
        emit('security_decision', 'regenerate: critical/high found', attempt, {
          blocking: decision.blocking.map(findingSummary),
          feedback,
        });
        if (attempt < this.maxAttempts) {
          emit('security_regenerate', 'regenerate with security feedback', attempt, {
            blocking: decision.blocking.length,
          });
          continue;
        }
        notes.push(`max attempts (${this.maxAttempts}) reached`);
        return finish('rejected_security');
      }

      emit('security_decision', decision.action, attempt, {
        warnings: decision.warnings.map(findingSummary),
      });

      let commit: TaskReport['commit'];
      if (this.commitEnabled) {
        try {
          commit = await this.committer.commit({
            runId: this.runId,
            task,
            attempt,
            code: maskSecrets(code),
            review: lastReview,
            warnings: decision.warnings,
            gatewayCalls,
          });
        } catch (err) {
          notes.push(`commit failed: ${errorMessage(err)}`);
          return finish('error');
        }
        emit('commit', commit.message, attempt, {
          ok: commit.ok,
          sha: commit.sha ?? null,
          dir: commit.dir ?? null,
        });
        if (!commit.ok) {
          notes.push(`commit failed: ${commit.message}`);
          return finish('error', commit);
        }
      } else {
        notes.push('commit disabled (dry-run)');
      }

      return finish(
        decision.action === 'commit_with_warning'
          ? 'committed_with_warning'
          : 'committed',
        commit,
      );
    }

    notes.push(`max attempts (${this.maxAttempts}) reached`);
    return finish('rejected_security');
  }

  private passThresholdsData(): Record<string, unknown> {
    return {
      gatewayUrl: this.gatewayUrl,
      maxAttempts: this.maxAttempts,
    };
  }
}

function sumTotals(reports: readonly TaskReport[]): RunTotals {
  const status = (s: TaskStatus): number => reports.filter((r) => r.status === s).length;
  return {
    tasks: reports.length,
    committed: status('committed'),
    committedWithWarning: status('committed_with_warning'),
    rejected: status('rejected_security'),
    gatewayBlocked:
      status('blocked_gateway_input') + status('blocked_gateway_output'),
    errors: status('error') + status('review_error'),
    llmCalls: reports.reduce((sum, r) => sum + r.llmCalls, 0),
    cleanCalls: reports.reduce((sum, r) => sum + r.gateway.clean, 0),
    blockedInput: reports.reduce((sum, r) => sum + r.gateway.blockedInput, 0),
    blockedOutput: reports.reduce((sum, r) => sum + r.gateway.blockedOutput, 0),
    warnings: reports.reduce((sum, r) => sum + r.security.medium + r.security.low, 0),
    blockingFindings: reports.reduce(
      (sum, r) => sum + r.security.critical + r.security.high,
      0,
    ),
  };
}
