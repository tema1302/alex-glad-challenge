import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { GatewayConfig, GatewayUpstreamConfig } from '../env.js';
import { MemoryAuditLog, MemoryInterceptedLog } from '../gateway/auditLog.js';
import { startGateway } from '../gateway/server.js';
import type { FetchFn } from '../gateway/upstream.js';
import { GatewayClient } from './gatewayClient.js';
import { SecurityExecutionLoop } from './loop.js';
import { MemoryLoopLogger } from './logger.js';
import type { CodeTask, CommitInput, CommitResult, Committer, TestResult, TestRunner } from './types.js';

const config: GatewayConfig = {
  host: '127.0.0.1',
  port: 0,
  rateLimitPerMin: 100,
  guardMode: 'block',
  maxBodyBytes: 200_000,
};

const upstream: GatewayUpstreamConfig = {
  provider: 'openai',
  baseUrl: 'https://upstream.test/v1',
  apiKey: 'test-key',
  model: 'test-model',
};

const task: CodeTask = {
  id: 'integration-task',
  title: 'Integration task',
  prompt: 'Сохрани токен безопасно.',
  stack: 'android',
  fileName: 'A.kt',
  scenario: 'security',
  requiredPatterns: [],
};

const PASS: TestResult = { ok: true, checks: [{ name: 'x', ok: true }] };

class FixedRunner implements TestRunner {
  async run(): Promise<TestResult> {
    return PASS;
  }
}

class RecordingCommitter implements Committer {
  readonly inputs: CommitInput[] = [];
  async commit(input: CommitInput): Promise<CommitResult> {
    this.inputs.push(input);
    return { ok: true, sha: 'abc1234', dir: 'challenge/.data/sandbox', message: 'ok' };
  }
}

function mockUpstream(responses: readonly string[]): {
  fetchFn: FetchFn;
  calls: Array<{ url: string; body: Record<string, unknown> }>;
} {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  let index = 0;
  const fetchFn: FetchFn = (url, init) => {
    calls.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    const content = responses[index] ?? 'no response';
    index += 1;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          model: 'test-model',
          choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
  };
  return { fetchFn, calls };
}

function criticalReview(): string {
  return JSON.stringify({
    summary: 'plaintext token',
    findings: [
      {
        severity: 'critical',
        category: 'insecure_storage',
        line: 1,
        title: 'plaintext token',
        evidence: 'val token = "x"',
        recommendation: 'EncryptedSharedPreferences',
      },
    ],
  });
}

function mediumReview(): string {
  return JSON.stringify({
    summary: 'no pinning',
    findings: [
      {
        severity: 'medium',
        category: 'missing_pinning',
        line: 2,
        title: 'no certificate pinning',
        evidence: 'OkHttpClient',
        recommendation: 'pin auth host',
      },
    ],
  });
}

function cleanReview(): string {
  return JSON.stringify({ summary: 'clean', findings: [] });
}

async function run(
  gatewayConfig: GatewayConfig,
  responses: readonly string[],
  loopTask: CodeTask,
): Promise<{
  report: import('./types.js').TaskReport;
  audit: MemoryAuditLog;
  intercepted: MemoryInterceptedLog;
  upstreamCalls: Array<{ url: string; body: Record<string, unknown> }>;
  committer: RecordingCommitter;
}> {
  const audit = new MemoryAuditLog();
  const intercepted = new MemoryInterceptedLog();
  const upstreamMock = mockUpstream(responses);
  const gateway = await startGateway({
    config: gatewayConfig,
    upstream,
    fetchFn: upstreamMock.fetchFn,
    audit,
    intercepted,
  });

  try {
    const client = new GatewayClient({ baseUrl: gateway.url });
    const committer = new RecordingCommitter();
    const loop = new SecurityExecutionLoop({
      runId: `integration-${randomUUID()}`,
      gatewayUrl: gateway.url,
      llm: client,
      committer,
      testRunner: new FixedRunner(),
      logger: new MemoryLoopLogger(),
      reportPath: path.join(tmpdir(), `sec-loop-int-${randomUUID()}.json`),
      now: () => new Date('2026-11-06T12:00:00.000Z'),
    });
    const result = await loop.run([loopTask]);
    return {
      report: result.tasks[0]!,
      audit,
      intercepted,
      upstreamCalls: upstreamMock.calls,
      committer,
    };
  } finally {
    await gateway.close();
  }
}

test('integration: все вызовы идут через gateway, audit чистый, commit после review', async () => {
  const { report, audit, upstreamCalls, committer } = await run(
    config,
    [
      'class A { val token = "plain" }',
      criticalReview(),
      'class A { fun save() {} }',
      mediumReview(),
    ],
    task,
  );

  assert.equal(report.status, 'committed_with_warning');
  assert.equal(report.attempts, 2);
  assert.equal(report.llmCalls, 4);
  assert.equal(report.gateway.clean, 4);
  assert.equal(upstreamCalls.length, 4);
  assert.equal(audit.records.length, 4);
  assert.ok(audit.records.every((r) => r.status === 'allowed'));
  assert.ok(audit.records.every((r) => r.inputFindings.length === 0));
  assert.ok(audit.records.every((r) => r.outputFindings.length === 0));
  assert.equal(committer.inputs.length, 1);
  assert.equal(committer.inputs[0]!.warnings.length, 1);
});

test('integration: gateway input block не доходит до upstream', async () => {
  const leakTask: CodeTask = {
    ...task,
    id: 'integration-leak',
    prompt: 'Используй ключ sk-proj-abc123 для запроса.',
  };
  const { report, audit, upstreamCalls, committer } = await run(config, [], leakTask);

  assert.equal(report.status, 'blocked_gateway_input');
  assert.equal(report.gateway.blockedInput, 1);
  assert.equal(upstreamCalls.length, 0);
  assert.equal(audit.records.length, 1);
  assert.equal(audit.records[0]!.status, 'blocked_input');
  assert.ok(audit.records[0]!.inputFindings.some((f) => f.kind === 'api_key'));
  assert.equal(committer.inputs.length, 0);
  assert.ok(!JSON.stringify(audit.records).includes('sk-proj-abc123'));
});

test('integration: mask mode логирует masked и не блокирует', async () => {
  const maskedConfig: GatewayConfig = { ...config, guardMode: 'mask' };
  const maskedTask: CodeTask = {
    ...task,
    id: 'integration-masked',
    prompt: 'Отправь отчёт на user@example.com.',
  };
  const { report, audit, upstreamCalls, committer } = await run(
    maskedConfig,
    ['class A {}', cleanReview()],
    maskedTask,
  );

  assert.equal(report.status, 'committed');
  assert.equal(report.gateway.masked, 2);
  assert.equal(upstreamCalls.length, 2);
  assert.equal(audit.records.length, 2);
  assert.ok(audit.records.every((r) => r.status === 'masked'));
  assert.ok(audit.records.every((r) => r.inputFindings.some((f) => f.kind === 'email')));
  assert.equal(committer.inputs.length, 1);
  assert.ok(!JSON.stringify(audit.records).includes('user@example.com'));
});
