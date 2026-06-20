// Конечный автомат pipeline блог-агентов (день 13).
//
// Состояния:
//   idle       → ожидание
//   planning   → выбор новости (агент 1)
//   execution  → написание поста (агент 2)
//   validation → фактчекинг (агент 3)
//   revision   → правка поста / смена новости (агент 4)
//   done       → завершён, пост готов
//
// День 15: строгая проверка переходов. Любой недопустимый переход → TransitionError.
// Состояние сериализуется в .data/pipeline-state.json.
// Это позволяет: паузу на любом этапе, продолжение без повторных объяснений.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { NewsRow } from '../db.js';
import type { FactCheckResult } from './factChecker.js';

export type PipelineStage = 'idle' | 'planning' | 'execution' | 'validation' | 'revision' | 'done';

export interface PipelineStep {
  stage: PipelineStage;
  label: string;
}

export interface PipelineState {
  stage: PipelineStage;
  step: string;
  expectedAction: string;
  newsRanked: Array<{ news: NewsRow; score: number; why: string }> | null;
  chosenNewsId: number | null;
  postContent: string | null;
  factCheck: FactCheckResult | null;
  revisionCount: number;
  history: Array<{ stage: PipelineStage; step: string; timestamp: string; detail: string }>;
}

export const STAGE_INFO: Record<PipelineStage, PipelineStep> = {
  idle: { stage: 'idle', label: 'Ожидание' },
  planning: { stage: 'planning', label: 'Выбор новости (агент 1)' },
  execution: { stage: 'execution', label: 'Написание поста (агент 2)' },
  validation: { stage: 'validation', label: 'Фактчекинг (агент 3)' },
  revision: { stage: 'revision', label: 'Правка (агент 4)' },
  done: { stage: 'done', label: 'Готово' },
};

// ── Разрешённые переходы (день 15) ──────────────────────────────────
// Любой переход не из этой таблицы → TransitionError.
// Нельзя: execution без planning, done без validation, revision без validation.
const ALLOWED_TRANSITIONS: Record<PipelineStage, PipelineStage[]> = {
  idle:       ['planning'],
  planning:   ['execution', 'idle'],
  execution:  ['validation', 'planning'],
  validation: ['revision', 'done', 'planning'],
  revision:   ['validation', 'done', 'planning'],
  done:       ['idle'],
};

export function isTransitionAllowed(from: PipelineStage, to: PipelineStage): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function allowedTransitions(from: PipelineStage): PipelineStage[] {
  return ALLOWED_TRANSITIONS[from] ?? [];
}

export class TransitionError extends Error {
  readonly from: PipelineStage;
  readonly to: PipelineStage;
  constructor(from: PipelineStage, to: PipelineStage) {
    const allowed = ALLOWED_TRANSITIONS[from] ?? [];
    super(`Переход "${from}" → "${to}" запрещён. Разрешено из "${from}": ${allowed.join(', ') || 'ничего'}`);
    this.from = from;
    this.to = to;
    this.name = 'TransitionError';
  }
}

export function createInitialState(): PipelineState {
  return {
    stage: 'idle',
    step: 'init',
    expectedAction: 'Запустить pipeline',
    newsRanked: null,
    chosenNewsId: null,
    postContent: null,
    factCheck: null,
    revisionCount: 0,
    history: [],
  };
}

export function transition(state: PipelineState, stage: PipelineStage, detail: string): PipelineState {
  if (!isTransitionAllowed(state.stage, stage)) {
    throw new TransitionError(state.stage, stage);
  }
  const info = STAGE_INFO[stage];
  state.history.push({
    stage: state.stage,
    step: state.step,
    timestamp: new Date().toISOString(),
    detail,
  });
  state.stage = stage;
  state.step = info.label;
  return state;
}

export function saveState(state: PipelineState, filePath: string): void {
  writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
}

export function loadState(filePath: string): PipelineState | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as PipelineState;
  } catch {
    return null;
  }
}

export function clearState(filePath: string): void {
  const state = createInitialState();
  saveState(state, filePath);
}

// Что ожидается от пользователя на каждом этапе.
export function expectedActionFor(stage: PipelineStage): string {
  switch (stage) {
    case 'idle': return 'Запустить: /pipeline run';
    case 'planning': return 'Выбрать новость: /pipeline pick <номер>';
    case 'execution': return 'Ожидание написания поста...';
    case 'validation': return 'Ожидание фактчекинга...';
    case 'revision': return 'Правки: /pipeline edit <текст>, /pipeline retry, /pipeline accept';
    case 'done': return 'Готово. /pipeline publish или /pipeline reset';
    default: return '?';
  }
}
