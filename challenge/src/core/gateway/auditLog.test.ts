import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  JsonlAuditLog,
  JsonlInterceptedLog,
  MemoryAuditLog,
  MemoryInterceptedLog,
  safePreview,
  type AuditRecord,
} from './auditLog.js';

const KEY = 'sk-proj-abc123';

function record(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    ts: '2026-11-04T00:00:00.000Z',
    requestId: 'gw_test',
    ip: '127.0.0.1',
    provider: 'openai',
    model: 'test-model',
    status: 'allowed',
    latencyMs: 1,
    inputFindings: [],
    outputFindings: [],
    promptPreview: '',
    responsePreview: '',
    ...overrides,
  };
}

test('safePreview: маскирует секрет и обрезает длину', () => {
  const out = safePreview(`key=${KEY} ${'x'.repeat(500)}`, 50);
  assert.ok(!out.includes(KEY));
  assert.ok(out.includes('[REDACTED_API_KEY]'));
  assert.ok(out.length <= 51);
});

test('MemoryAuditLog: хранит записи', () => {
  const log = new MemoryAuditLog();
  log.write(record());
  assert.equal(log.records.length, 1);
});

test('JsonlAuditLog/JsonlInterceptedLog: пишут JSONL без сырых секретов', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gw-audit-'));
  try {
    const auditPath = path.join(dir, 'audit.jsonl');
    const interceptedPath = path.join(dir, 'intercepted.jsonl');
    new JsonlAuditLog(auditPath).write(
      record({ promptPreview: safePreview(`secret ${KEY}`) }),
    );
    const intercepted = new MemoryInterceptedLog();
    new JsonlInterceptedLog(interceptedPath).write({
      ts: '2026-11-04T00:00:00.000Z',
      requestId: 'gw_test',
      direction: 'input',
      kind: 'api_key',
      severity: 'critical',
      preview: 'sk-p***23',
      via: 'direct',
    });
    const auditText = readFileSync(auditPath, 'utf8');
    const interceptedText = readFileSync(interceptedPath, 'utf8');
    assert.ok(!auditText.includes(KEY));
    assert.ok(!interceptedText.includes(KEY));
    assert.equal(JSON.parse(auditText.trim()).status, 'allowed');
    assert.equal(JSON.parse(interceptedText.trim()).direction, 'input');
    assert.equal(intercepted.records.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
