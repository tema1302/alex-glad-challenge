import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifySecurityReview,
  formatSecurityFeedback,
  gatewayFindingsToSecurity,
  parseSecurityReview,
} from './review.js';

test('parseSecurityReview: fenced JSON, findings, line', () => {
  const raw = '```json\n{"summary":"ok","findings":[{"severity":"critical","category":"insecure_storage","line":14,"title":"plaintext token","evidence":"prefs.token","recommendation":"EncryptedSharedPreferences"}]}\n```';
  const parsed = parseSecurityReview(raw);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.review.summary, 'ok');
  assert.equal(parsed.review.findings.length, 1);
  assert.deepEqual(parsed.review.findings[0], {
    severity: 'critical',
    category: 'insecure_storage',
    line: 14,
    title: 'plaintext token',
    evidence: 'prefs.token',
    recommendation: 'EncryptedSharedPreferences',
  });
});

test('parseSecurityReview: issues alias', () => {
  const parsed = parseSecurityReview(
    '{"summary":"x","issues":[{"severity":"high","title":"http url","line":"42"}]}',
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.review.findings[0]!.line, 42);
  assert.equal(parsed.review.findings[0]!.severity, 'high');
});

test('parseSecurityReview: неизвестная severity → high (fail-closed)', () => {
  const parsed = parseSecurityReview(
    '{"findings":[{"severity":"info","title":"suspicious"}]}',
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.review.findings[0]!.severity, 'high');
});

test('parseSecurityReview: нет findings → fail-closed', () => {
  const parsed = parseSecurityReview('{"summary":"x"}');
  assert.equal(parsed.ok, false);
});

test('parseSecurityReview: невалидный JSON → fail-closed', () => {
  const parsed = parseSecurityReview('security review: looks good');
  assert.equal(parsed.ok, false);
});

test('parseSecurityReview: findings не массив → fail-closed', () => {
  const parsed = parseSecurityReview('{"findings":"none"}');
  assert.equal(parsed.ok, false);
});

test('parseSecurityReview: malformed finding не теряется молча', () => {
  const parsed = parseSecurityReview('{"findings":[{"severity":"high"}]}');
  assert.equal(parsed.ok, false);
});

test('parseSecurityReview: >50 findings → fail-closed', () => {
  const findings = Array.from({ length: 51 }, (_, i) => ({
    severity: 'low',
    title: `f${i}`,
  }));
  const parsed = parseSecurityReview(JSON.stringify({ findings }));
  assert.equal(parsed.ok, false);
});

test('parseSecurityReview: evidence маскирует PII/секреты', () => {
  const parsed = parseSecurityReview(
    '{"findings":[{"severity":"high","title":"log","evidence":"user@example.com sk-proj-abc123"}]}',
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const evidence = parsed.review.findings[0]!.evidence;
  assert.ok(!evidence.includes('user@example.com'));
  assert.ok(!evidence.includes('sk-proj-abc123'));
  assert.ok(evidence.includes('[REDACTED_EMAIL]'));
  assert.ok(evidence.includes('[REDACTED_API_KEY]'));
});

test('classifySecurityReview: critical/high → regenerate', () => {
  const decision = classifySecurityReview({
    summary: '',
    findings: [
      { severity: 'critical', category: 'other', line: 1, title: 'a', evidence: '', recommendation: '' },
      { severity: 'high', category: 'other', line: 2, title: 'b', evidence: '', recommendation: '' },
      { severity: 'medium', category: 'other', line: 3, title: 'c', evidence: '', recommendation: '' },
    ],
  });
  assert.equal(decision.action, 'regenerate');
  assert.equal(decision.blocking.length, 2);
  assert.equal(decision.warnings.length, 1);
});

test('classifySecurityReview: только medium/low → commit с warning', () => {
  const decision = classifySecurityReview({
    summary: '',
    findings: [
      { severity: 'medium', category: 'other', line: 1, title: 'a', evidence: '', recommendation: '' },
      { severity: 'low', category: 'other', line: 2, title: 'b', evidence: '', recommendation: '' },
    ],
  });
  assert.equal(decision.action, 'commit_with_warning');
  assert.equal(decision.blocking.length, 0);
  assert.equal(decision.warnings.length, 2);
});

test('classifySecurityReview: пусто → commit', () => {
  const decision = classifySecurityReview({ summary: 'clean', findings: [] });
  assert.equal(decision.action, 'commit');
});

test('formatSecurityFeedback: «строка N» + severity + fix', () => {
  const text = formatSecurityFeedback([
    {
      severity: 'critical',
      category: 'insecure_storage',
      line: 42,
      title: 'SQL injection',
      evidence: '',
      recommendation: 'parameterized query',
    },
  ]);
  assert.ok(text.includes('строка 42'));
  assert.ok(text.includes('[CRITICAL]'));
  assert.ok(text.includes('SQL injection'));
  assert.ok(text.includes('parameterized query'));
});

test('gatewayFindingsToSecurity: локально находит строку и не светит секрет', () => {
  const code = 'class A {\n  val key = "sk-proj-abc123"\n}';
  const findings = gatewayFindingsToSecurity(code, [
    { kind: 'api_key', severity: 'critical', preview: 'sk-p***23' },
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.line, 2);
  assert.equal(findings[0]!.severity, 'critical');
  assert.ok(findings[0]!.title.includes('api_key'));
  assert.ok(!findings[0]!.evidence.includes('sk-proj-abc123'));
});

test('gatewayFindingsToSecurity: дубликаты kind схлопываются', () => {
  const code = 'val key = "sk-proj-abc123"';
  const findings = gatewayFindingsToSecurity(code, [
    { kind: 'api_key', severity: 'critical', preview: 'sk-p***23' },
    { kind: 'api_key', severity: 'critical', preview: 'sk-p***23' },
  ]);
  assert.equal(findings.length, 1);
});

test('gatewayFindingsToSecurity: без findings даёт синтетический high', () => {
  const findings = gatewayFindingsToSecurity('class A {}', []);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.severity, 'high');
});
