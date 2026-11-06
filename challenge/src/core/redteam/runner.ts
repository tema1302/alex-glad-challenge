// Runner red team (ADVANCED day-15): прогон набора атак по target + отчёт.
//
// Отчёт содержит только безопасные поля (kind/stage/detail без payload) —
// перед записью прогоняется scanSecrets-проверка в тесте и маскирование в
// outcome().

import { randomBytes } from 'node:crypto';

import { writeJsonReport } from '../securityLoop/logger.js';
import { dataPath } from '../paths.js';
import type { AttackCase, AttackOutcome, AttackTarget, RedTeamReport, RedTeamTotals } from './types.js';

export interface RunRedTeamOptions {
  readonly runId?: string;
  readonly now?: () => Date;
  /** Переопределение пути отчёта (тесты пишут во временный каталог). */
  readonly reportPath?: string;
}

function totalsOf(results: readonly AttackOutcome[]): RedTeamTotals {
  const residual = results.filter((r) => r.kind === 'residual').length;
  const breached = results.filter((r) => !r.defended && r.kind !== 'residual').length;
  const defended = results.filter((r) => r.defended).length;
  return {
    attacks: results.length,
    defended,
    breached,
    residual,
    // residual-атаки не считаются провалом: это документированные риски.
    pass: breached === 0,
  };
}

export async function runRedTeam(
  target: AttackTarget,
  cases: readonly AttackCase[],
  opts: RunRedTeamOptions = {},
): Promise<RedTeamReport> {
  if (cases.length === 0) throw new RangeError('at least one attack case is required');
  const now = opts.now ?? (() => new Date());
  const runId = opts.runId ?? `rt-${now().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '').replace('T', '-')}-${randomBytes(2).toString('hex')}`;

  const startedAt = now().toISOString();
  const results: AttackOutcome[] = [];
  for (const attack of cases) {
    results.push(await attack.run(target));
  }

  const report: RedTeamReport = {
    runId,
    startedAt,
    finishedAt: now().toISOString(),
    target: target.name,
    totals: totalsOf(results),
    results,
  };
  writeJsonReport(opts.reportPath ?? dataPath('red-team', runId, 'report.json'), report);
  return report;
}
