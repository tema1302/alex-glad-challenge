import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { GatewayBlockedError } from './gatewayClient.js';
import { SecurityExecutionLoop } from './loop.js';
import { MemoryLoopLogger } from './logger.js';
import type {
  CodeTask,
  CommitInput,
  CommitResult,
  Committer,
  LlmCaller,
  LlmCallOptions,
  LlmResult,
  LoopStage,
  TestResult,
  TestRunner,
} from './types.js';

const task: CodeTask = {
  id: 't1-test',
  title: 'Token storage',
  prompt: 'Сохрани токен.',
  stack: 'android',
  fileName: 'TokenStore.kt',
  scenario: 'security',
  requiredPatterns: [],
};

const INSECURE = 'class TokenStore {\n  val token = "plain"\n}';
const SECURE = 'class TokenStore {\n  fun save() {}\n  fun load() {}\n}';
const CODE_WITH_KEY = 'class TokenStore {\n  val key = "sk-proj-abc123"\n}';

function ok(content: string, stage: LoopStage): LlmResult {
  return {
    content,
    info: {
      stage,
      requestId: `req-${stage}`,
      input: 'allow',
      output: 'allow',
      warning: null,
      costUsd: 0.001,
    },
  };
}

function review(findings: unknown[]): string {
  return JSON.stringify({ summary: 'review', findings });
}

const CRITICAL = review([
  {
    severity: 'critical',
    category: 'insecure_storage',
    line: 1,
    title: 'plaintext token storage',
    evidence: 'val token = "plain"',
    recommendation: 'EncryptedSharedPreferences / Keystore',
  },
]);

const MEDIUM = review([
  {
    severity: 'medium',
    category: 'missing_pinning',
    line: 2,
    title: 'no certificate pinning',
    evidence: 'OkHttpClient',
    recommendation: 'pin auth host',
  },
]);

const CLEAN = review([]);

class ScriptedLlm implements LlmCaller {
  readonly calls: Array<{ messages: readonly { role: string; content: string }[]; stage: LoopStage | undefined }> = [];
  private readonly queue: Array<LlmResult | Error>;

  constructor(responses: Array<LlmResult | Error>) {
    this.queue = [...responses];
  }

  async chat(
    messages: readonly { role: string; content: string }[],
    opts?: LlmCallOptions,
  ): Promise<LlmResult> {
    this.calls.push({ messages: [...messages], stage: opts?.stage });
    const next = this.queue.shift();
    if (!next) throw new Error('script exhausted');
    if (next instanceof Error) throw next;
    return { ...next, info: { ...next.info, stage: opts?.stage ?? next.info.stage } };
  }
}

class RecordingCommitter implements Committer {
  readonly inputs: CommitInput[] = [];

  async commit(input: CommitInput): Promise<CommitResult> {
    this.inputs.push(input);
    return {
      ok: true,
      sha: 'abc1234',
      dir: `challenge/.data/security-loop/sandbox/${input.runId}/${input.task.id}`,
      message: 'sandbox commit',
    };
  }
}

class FixedRunner implements TestRunner {
  constructor(private readonly result: TestResult) {}
  async run(): Promise<TestResult> {
    return this.result;
  }
}

class ScriptedRunner implements TestRunner {
  private readonly queue: TestResult[];
  constructor(results: TestResult[]) {
    this.queue = [...results];
  }
  async run(): Promise<TestResult> {
    return this.queue.shift() ?? { ok: true, checks: [] };
  }
}

class ThrowingRunner implements TestRunner {
  async run(): Promise<TestResult> {
    throw new Error('runner boom sk-proj-abc123');
  }
}

const PASS: TestResult = { ok: true, checks: [{ name: 'x', ok: true }] };
const FAIL: TestResult = {
  ok: false,
  checks: [{ name: 'contract:save', ok: false, detail: 'missing save' }],
};

async function run(
  responses: Array<LlmResult | Error>,
  opts: {
    testRunner?: TestRunner;
    maxAttempts?: number;
    commit?: boolean;
  } = {},
): Promise<{
  report: import('./types.js').TaskReport;
  llm: ScriptedLlm;
  committer: RecordingCommitter;
  logger: MemoryLoopLogger;
}> {
  const llm = new ScriptedLlm(responses);
  const committer = new RecordingCommitter();
  const logger = new MemoryLoopLogger();
  const loop = new SecurityExecutionLoop({
    runId: 'run-test',
    gatewayUrl: 'http://127.0.0.1:3040',
    llm,
    committer,
    logger,
    testRunner: opts.testRunner ?? new FixedRunner(PASS),
    maxAttempts: opts.maxAttempts,
    commit: opts.commit ?? true,
    reportPath: path.join(tmpdir(), `sec-loop-${randomUUID()}.json`),
    now: () => new Date('2026-11-06T12:00:00.000Z'),
  });
  const result = await loop.run([task]);
  return { report: result.tasks[0]!, llm, committer, logger };
}

test('loop: critical → retry → medium → commit with warning', async () => {
  const { report, llm, committer } = await run([
    ok(INSECURE, 'generation'),
    ok(CRITICAL, 'security_review'),
    ok(SECURE, 'generation'),
    ok(MEDIUM, 'security_review'),
  ]);

  assert.equal(report.status, 'committed_with_warning');
  assert.equal(report.attempts, 2);
  assert.equal(report.llmCalls, 4);
  assert.equal(report.security.critical, 0);
  assert.equal(report.security.medium, 1);
  assert.equal(committer.inputs.length, 1);
  assert.equal(committer.inputs[0]!.warnings.length, 1);
  assert.equal(committer.inputs[0]!.code, SECURE);

  const retryPrompt = llm.calls[2]!.messages[1]!.content;
  assert.ok(retryPrompt.includes('строка 1'));
  assert.ok(retryPrompt.includes('[CRITICAL]'));
  assert.ok(retryPrompt.includes('plaintext token storage'));
});

test('loop: clean review → commit', async () => {
  const { report, committer } = await run([
    ok(INSECURE, 'generation'),
    ok(CLEAN, 'security_review'),
  ]);
  assert.equal(report.status, 'committed');
  assert.equal(report.attempts, 1);
  assert.equal(report.llmCalls, 2);
  assert.equal(committer.inputs.length, 1);
  assert.equal(committer.inputs[0]!.warnings.length, 0);
});

test('loop: gateway input block на generation → стоп, без commit', async () => {
  const blocked = new GatewayBlockedError(
    'input',
    422,
    [{ kind: 'api_key', severity: 'critical', preview: 'sk-p***23' }],
    'Input Guard blocked',
    'gw_block',
    null,
  );
  const { report, committer, logger } = await run([blocked]);
  assert.equal(report.status, 'blocked_gateway_input');
  assert.equal(report.attempts, 1);
  assert.equal(report.llmCalls, 1);
  assert.equal(report.gateway.blockedInput, 1);
  assert.equal(report.security.critical, 1);
  assert.equal(committer.inputs.length, 0);
  assert.ok(logger.events.some((e) => e.type === 'gateway_blocked'));
});

test('loop: gateway output block на generation → стоп, synthetic high', async () => {
  const blocked = new GatewayBlockedError('output', 200, [], 'blocked', 'gw_out', null);
  const { report, committer } = await run([blocked]);
  assert.equal(report.status, 'blocked_gateway_output');
  assert.equal(report.gateway.blockedOutput, 1);
  assert.equal(report.security.high, 1);
  assert.equal(committer.inputs.length, 0);
});

test('loop: tests fail → regenerate до review', async () => {
  const runner = new ScriptedRunner([FAIL, PASS]);
  const { report, llm, committer } = await run(
    [ok(INSECURE, 'generation'), ok(SECURE, 'generation'), ok(CLEAN, 'security_review')],
    { testRunner: runner },
  );
  assert.equal(report.status, 'committed');
  assert.equal(report.attempts, 2);
  assert.equal(report.llmCalls, 3);
  assert.equal(committer.inputs.length, 1);
  const retryPrompt = llm.calls[1]!.messages[1]!.content;
  assert.ok(retryPrompt.includes('Тесты/lint не прошли'));
  assert.ok(retryPrompt.includes('contract:save'));
});

test('loop: gateway input block на review → retry с локальной строкой', async () => {
  const blocked = new GatewayBlockedError(
    'input',
    422,
    [{ kind: 'api_key', severity: 'critical', preview: 'sk-p***23' }],
    'Input Guard blocked',
    'gw_block_review',
    null,
  );
  const { report, llm, committer } = await run([
    ok(CODE_WITH_KEY, 'generation'),
    blocked,
    ok(SECURE, 'generation'),
    ok(CLEAN, 'security_review'),
  ]);

  assert.equal(report.status, 'committed');
  assert.equal(report.attempts, 2);
  assert.equal(report.llmCalls, 4);
  assert.equal(report.gateway.blockedInput, 1);
  assert.equal(committer.inputs.length, 1);

  const retryPrompt = llm.calls[2]!.messages[1]!.content;
  assert.ok(retryPrompt.includes('gateway input guard: api_key'));
  assert.ok(retryPrompt.includes('строка 2'));
  assert.ok(!retryPrompt.includes('sk-proj-abc123'));
  assert.ok(retryPrompt.includes('[REDACTED_API_KEY]'));
});

test('loop: невалидный JSON review → review_error, без commit', async () => {
  const { report, committer } = await run([
    ok(INSECURE, 'generation'),
    ok('security review: looks good', 'security_review'),
  ]);
  assert.equal(report.status, 'review_error');
  assert.equal(committer.inputs.length, 0);
  assert.ok(report.notes.some((n) => n.includes('security review:')));
});

test('loop: max attempts → rejected_security, без commit', async () => {
  const { report, committer } = await run(
    [
      ok(INSECURE, 'generation'),
      ok(CRITICAL, 'security_review'),
      ok(INSECURE, 'generation'),
      ok(CRITICAL, 'security_review'),
      ok(INSECURE, 'generation'),
      ok(CRITICAL, 'security_review'),
    ],
    { maxAttempts: 3 },
  );
  assert.equal(report.status, 'rejected_security');
  assert.equal(report.attempts, 3);
  assert.equal(report.llmCalls, 6);
  assert.equal(committer.inputs.length, 0);
  assert.ok(report.notes.some((n) => n.includes('max attempts')));
});

test('loop: пустой ответ без кода → retry', async () => {
  const { report, llm } = await run([
    ok('Не могу помочь.', 'generation'),
    ok(SECURE, 'generation'),
    ok(CLEAN, 'security_review'),
  ]);
  assert.equal(report.status, 'committed');
  assert.equal(report.attempts, 2);
  assert.equal(report.llmCalls, 3);
  assert.ok(llm.calls[1]!.messages[1]!.content.includes('В ответе не найден код'));
});

test('loop: commit=false → dry-run без commit', async () => {
  const { report, committer } = await run(
    [ok(INSECURE, 'generation'), ok(CLEAN, 'security_review')],
    { commit: false },
  );
  assert.equal(report.status, 'committed');
  assert.equal(committer.inputs.length, 0);
  assert.ok(report.notes.some((n) => n.includes('dry-run')));
});

test('loop: события содержат gateway-guard и решения', async () => {
  const { logger } = await run([
    ok(INSECURE, 'generation'),
    ok(CRITICAL, 'security_review'),
    ok(SECURE, 'generation'),
    ok(MEDIUM, 'security_review'),
  ]);
  const types = logger.events.map((e) => e.type);
  assert.ok(types.includes('run_start'));
  assert.ok(types.includes('generation_result'));
  assert.ok(types.includes('tests_result'));
  assert.ok(types.includes('security_review_result'));
  assert.ok(types.includes('security_regenerate'));
  assert.ok(types.includes('commit'));
  assert.ok(types.includes('task_end'));
  assert.ok(types.includes('run_end'));
  const result = logger.events.find((e) => e.type === 'security_review_result');
  assert.equal(result?.data?.decision, 'regenerate');
});

test('loop: исключение test runner → error, сообщение маскируется', async () => {
  const { report, committer, logger } = await run([ok(SECURE, 'generation')], {
    testRunner: new ThrowingRunner(),
  });
  assert.equal(report.status, 'error');
  assert.equal(committer.inputs.length, 0);
  const text = JSON.stringify(logger.events);
  assert.ok(!text.includes('sk-proj-abc123'));
  assert.ok(text.includes('[REDACTED_API_KEY]'));
});

test('loop: события не содержат абсолютных путей', async () => {
  const { logger } = await run([
    ok(INSECURE, 'generation'),
    ok(CLEAN, 'security_review'),
  ]);
  const text = JSON.stringify(logger.events);
  assert.ok(!/[A-Za-z]:\\\\/.test(text), 'windows absolute path leaked');
  assert.ok(!text.includes('/Users/'), 'posix home path leaked');
  assert.ok(!text.includes('/home/'), 'posix home path leaked');
});
