// Day 15: набор атак red team против пайплайна (offline, scripted LLM).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ATTACK_CASES } from './cases.js';
import { PipelineTarget } from './target.js';
import { runRedTeam } from './runner.js';
import type { RedTeamReport } from './types.js';

const target = new PipelineTarget();

test('red team: все baseline-атаки остановлены', async () => {
  for (const attack of ATTACK_CASES.filter((c) => c.kind === 'baseline')) {
    const result = await attack.run(target);
    assert.ok(result.defended, `${attack.id}: ${attack.title} должно быть остановлено`);
  }
});

test('red team: все hardening-атаки остановлены после day-15 фиксов', async () => {
  for (const attack of ATTACK_CASES.filter((c) => c.kind === 'hardening')) {
    const result = await attack.run(target);
    assert.ok(result.defended, `${attack.id}: ${attack.title} должно быть остановлено`);
  }
});

test('red team: residual-атаки остаются пробитием (документированные риски)', async () => {
  const residual = ATTACK_CASES.filter((c) => c.kind === 'residual');
  assert.ok(residual.length >= 1, 'должен быть хотя бы один документированный residual');
  for (const attack of residual) {
    const result = await attack.run(target);
    assert.equal(result.defended, false, `${attack.id}: residual остаётся пробитием (см. README)`);
  }
  assert.ok(
    residual.some((c) => c.id === 'RT-12'),
    'RT-12 (system prompt кусками) остаётся в residual-наборе',
  );
});

test('red team: полный прогон — pass, отчёт без сырых секретов', async () => {
  const reportPath = path.join(mkdtempSync(path.join(tmpdir(), 'redteam-')), 'report.json');
  const report: RedTeamReport = await runRedTeam(target, ATTACK_CASES, {
    runId: 'rt-test',
    reportPath,
    now: () => new Date('2026-11-06T12:00:00.000Z'),
  });
  assert.equal(report.totals.attacks, ATTACK_CASES.length);
  assert.equal(report.totals.breached, 0);
  assert.equal(report.totals.pass, true);
  assert.equal(report.runId, 'rt-test');

  const text = JSON.stringify(report);
  // Фейковые фикстуры не должны утекать в отчёт.
  assert.ok(!text.includes('sk-testABC'));
  assert.ok(!text.includes('ghp_A1b2'));
  assert.ok(!text.includes('c2stdGVzd'));
});
