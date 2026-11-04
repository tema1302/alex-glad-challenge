// Полный демо-прогон security-недели (ADVANCED days 11–12).
//
// День 11 и день 12 запускаются независимо: day-11 — все профили system
// prompt × 6 direct-атак, day-12 — все indirect-векторы × 5 режимов защиты.
// Модуль только оркестрирует лаборатории и агрегирует результаты; клиент
// инжектится как ChatFn, поэтому тесты не ходят в сеть.

import {
  bankTarget,
  defaultAttacks,
  hardenedBankTarget,
  hardenedMediumTarget,
  mediumTarget,
  runInjectionAttacks,
  summarizeByTechnique,
} from './injectionLab.js';
import type {
  AttackResult,
  ChatFn,
  InjectionAttack,
  InjectionTarget,
  InjectionTechnique,
  RunLabOptions,
} from './injectionLab.js';
import { allVectors, runIndirectAttack } from './indirectLab.js';
import type {
  DefenseMode,
  IndirectAttackResult,
  IndirectRunOptions,
  IndirectVector,
} from './indirectLab.js';

export type DemoDay = 'day-11' | 'day-12' | 'all';

export interface DemoBucket {
  readonly passed: number;
  readonly total: number;
}

export interface Day11ProfileResult {
  readonly target: InjectionTarget;
  readonly hardened: boolean;
  readonly results: readonly AttackResult[];
  readonly byTechnique: ReadonlyMap<InjectionTechnique, DemoBucket>;
  readonly passed: number;
  readonly total: number;
}

export interface Day11DemoReport {
  readonly day: 'day-11';
  readonly attacks: readonly InjectionAttack[];
  readonly profiles: readonly Day11ProfileResult[];
  readonly passed: number;
  readonly total: number;
  readonly initial: DemoBucket;
  readonly hardened: DemoBucket;
}

export interface Day11DemoOptions extends RunLabOptions {
  readonly author?: string;
  readonly targets?: readonly InjectionTarget[];
  readonly attacks?: readonly InjectionAttack[];
}

export interface Day12DemoReport {
  readonly day: 'day-12';
  readonly vectors: readonly IndirectVector[];
  readonly modes: readonly DefenseMode[];
  readonly results: readonly IndirectAttackResult[];
  readonly byVector: ReadonlyMap<string, DemoBucket>;
  readonly byMode: ReadonlyMap<DefenseMode, DemoBucket>;
  readonly passed: number;
  readonly total: number;
}

export interface Day12DemoOptions extends IndirectRunOptions {
  readonly vectors?: readonly IndirectVector[];
  readonly modes?: readonly DefenseMode[];
}

export interface SecurityDemoOptions
  extends Day11DemoOptions,
    Day12DemoOptions {}

export interface SecurityDemoReport {
  readonly day11?: Day11DemoReport;
  readonly day12?: Day12DemoReport;
}

/** Все режимы защиты дня 12 в порядке матрицы. */
export const ALL_DEFENSE_MODES: readonly DefenseMode[] = [
  'none',
  'sanitize',
  'boundary',
  'output',
  'all',
];

/** Профили дня 11: исходные цели и их усиленные версии. */
export function defaultDay11Targets(
  authorName = 'Гоша',
): readonly InjectionTarget[] {
  return [
    bankTarget(),
    mediumTarget(authorName),
    hardenedBankTarget(),
    hardenedMediumTarget(authorName),
  ];
}

/** Усиленный ли профиль (id заканчивается на -hardened). */
export function isHardenedTarget(target: InjectionTarget): boolean {
  return target.id.endsWith('-hardened');
}

function bucket(passed: number, total: number): DemoBucket {
  return { passed, total };
}

function sumBuckets(buckets: readonly DemoBucket[]): DemoBucket {
  return buckets.reduce<DemoBucket>(
    (acc, b) => bucket(acc.passed + b.passed, acc.total + b.total),
    bucket(0, 0),
  );
}

function countPassed(results: readonly { readonly succeeded: boolean }[]): number {
  return results.filter((r) => r.succeeded).length;
}

/** Полный прогон дня 11: каждый профиль против каждой direct-атаки. */
export async function runDay11Demo(
  chat: ChatFn,
  opts: Day11DemoOptions = {},
): Promise<Day11DemoReport> {
  const attacks = opts.attacks ?? defaultAttacks();
  const targets = opts.targets ?? defaultDay11Targets(opts.author);
  const runOpts: RunLabOptions = {
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    seed: opts.seed,
  };

  const profiles: Day11ProfileResult[] = [];
  for (const target of targets) {
    const results = await runInjectionAttacks(chat, target, attacks, runOpts);
    const passed = countPassed(results);
    profiles.push({
      target,
      hardened: isHardenedTarget(target),
      results,
      byTechnique: summarizeByTechnique(results),
      passed,
      total: results.length,
    });
  }

  const initial = sumBuckets(
    profiles.filter((p) => !p.hardened).map((p) => bucket(p.passed, p.total)),
  );
  const hardened = sumBuckets(
    profiles.filter((p) => p.hardened).map((p) => bucket(p.passed, p.total)),
  );
  const total = sumBuckets(profiles.map((p) => bucket(p.passed, p.total)));

  return {
    day: 'day-11',
    attacks,
    profiles,
    passed: total.passed,
    total: total.total,
    initial,
    hardened,
  };
}

/** Полный прогон дня 12: каждый вектор против каждого режима защиты. */
export async function runDay12Demo(
  chat: ChatFn,
  opts: Day12DemoOptions = {},
): Promise<Day12DemoReport> {
  const vectors = opts.vectors ?? allVectors();
  const modes = opts.modes ?? ALL_DEFENSE_MODES;
  const runOpts: IndirectRunOptions = {
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    seed: opts.seed,
  };

  const results: IndirectAttackResult[] = [];
  for (const vector of vectors) {
    for (const mode of modes) {
      results.push(await runIndirectAttack(chat, vector, mode, runOpts));
    }
  }

  const byVector = new Map<string, DemoBucket>();
  const byMode = new Map<DefenseMode, DemoBucket>();
  for (const r of results) {
    const v = byVector.get(r.vectorId) ?? bucket(0, 0);
    byVector.set(r.vectorId, bucket(v.passed + (r.passed ? 1 : 0), v.total + 1));

    const m = byMode.get(r.mode) ?? bucket(0, 0);
    byMode.set(r.mode, bucket(m.passed + (r.passed ? 1 : 0), m.total + 1));
  }

  return {
    day: 'day-12',
    vectors,
    modes,
    results,
    byVector,
    byMode,
    passed: results.filter((r) => r.passed).length,
    total: results.length,
  };
}

/** Демо выбранного дня (или обоих дней) одним вызовом. */
export async function runSecurityDemo(
  chat: ChatFn,
  day: DemoDay,
  opts: SecurityDemoOptions = {},
): Promise<SecurityDemoReport> {
  const report: { day11?: Day11DemoReport; day12?: Day12DemoReport } = {};
  if (day === 'day-11' || day === 'all') {
    report.day11 = await runDay11Demo(chat, opts);
  }
  if (day === 'day-12' || day === 'all') {
    report.day12 = await runDay12Demo(chat, opts);
  }
  return report;
}

// --- Пошаговый план для live-чата (sec-chat --auto) ---

export interface Day11ChatStep {
  readonly target: InjectionTarget;
  readonly attack: InjectionAttack;
}

/** Порядок live-демо дня 11: профиль × все атаки, затем следующий профиль. */
export function day11ChatSteps(
  targets: readonly InjectionTarget[] = defaultDay11Targets(),
  attacks: readonly InjectionAttack[] = defaultAttacks(),
): readonly Day11ChatStep[] {
  const steps: Day11ChatStep[] = [];
  for (const target of targets) {
    for (const attack of attacks) {
      steps.push({ target, attack });
    }
  }
  return steps;
}

export interface Day12ChatStep {
  readonly vector: IndirectVector;
  readonly mode: DefenseMode;
}

/** Порядок live-демо дня 12: вектор × все режимы защиты, затем следующий вектор. */
export function day12ChatSteps(
  vectors: readonly IndirectVector[] = allVectors(),
  modes: readonly DefenseMode[] = ALL_DEFENSE_MODES,
): readonly Day12ChatStep[] {
  const steps: Day12ChatStep[] = [];
  for (const vector of vectors) {
    for (const mode of modes) {
      steps.push({ vector, mode });
    }
  }
  return steps;
}

/** Нормализация значения --day: 11, 12, day-11, all → DemoDay. */
export function parseDemoDay(raw: string): DemoDay | undefined {
  const value = raw.trim().toLowerCase();
  if (value === '11' || value === 'day-11') return 'day-11';
  if (value === '12' || value === 'day-12') return 'day-12';
  if (value === 'all') return 'all';
  return undefined;
}
