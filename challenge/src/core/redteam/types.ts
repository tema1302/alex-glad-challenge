// Контракты red team (ADVANCED day-15): набор атак по своему пайплайну.
//
// Атака проверяет ДЕТЕРМИНИРОВАННЫЙ слой защиты (guards, сканеры, backstop),
// поэтому работает офлайн: «взломанная» модель подменяется scripted LlmCaller,
// сеть не нужна. Сырые значения секретов в отчёт не попадают — только kind.

import type { ChatMessage } from '../types.js';
import type { CodeTask, SecurityDecision, LlmCaller } from '../securityLoop/types.js';

export type RedTeamVector =
  | 'secret_leak'
  | 'system_prompt_leak'
  | 'prompt_injection'
  | 'indirect_injection'
  | 'review_bypass';

export type CaseKind = 'baseline' | 'hardening' | 'residual';

export interface ScanVerdict {
  readonly blocked: boolean;
  readonly redacted: boolean;
  readonly kinds: readonly string[];
}

export interface ReviewStageVerdict {
  readonly decision: SecurityDecision['action'] | 'review_error';
  readonly blocking: number;
  readonly backstop: number;
}

export interface GenerationVerdict {
  readonly code: string | null;
  /** true — output guard заблокировал ответ модели. */
  readonly blocked: boolean;
  readonly kinds: readonly string[];
}

/** Поверхности пайплайна, по которым бьёт red team. */
export interface AttackTarget {
  readonly name: string;
  /** Input guard: блокирует ли сообщение (например, подложенный файл). */
  scanInput(text: string): ScanVerdict;
  /** Input guard для нескольких сообщений: split секрета/инструкции между ними. */
  scanInputParts(parts: readonly string[]): ScanVerdict;
  /** Output guard: блокирует/редактирует ли ответ модели. */
  scanOutput(text: string, systemPrompt?: string): ScanVerdict;
  /** Путь generation → extractCode → security review → evaluate + classify. */
  generateAndReview(opts: {
    readonly task: CodeTask;
    readonly generation: LlmCaller;
    readonly review: LlmCaller;
    readonly systemPrompt: string;
  }): Promise<{ generation: GenerationVerdict; review: ReviewStageVerdict | null }>;
}

export interface AttackOutcome {
  readonly id: string;
  readonly vector: RedTeamVector;
  readonly title: string;
  readonly kind: CaseKind;
  /** true — детерминированный слой остановил атаку. */
  readonly defended: boolean;
  /** Где именно сработала/пробилась защита (safe-метка, не payload). */
  readonly stage: string;
  readonly detail: string;
  readonly kinds: readonly string[];
}

export interface AttackCase {
  readonly id: string;
  readonly vector: RedTeamVector;
  readonly title: string;
  /** Ожидание в hardened-пайплайне (для отчёта). */
  readonly expectation: string;
  /** baseline — работало до day-15; hardening — закрыто day-15; residual — известный риск. */
  readonly kind: CaseKind;
  run(target: AttackTarget): Promise<AttackOutcome>;
}

export interface RedTeamTotals {
  readonly attacks: number;
  readonly defended: number;
  readonly breached: number;
  readonly residual: number;
  readonly pass: boolean;
}

export interface RedTeamReport {
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly target: string;
  readonly totals: RedTeamTotals;
  readonly results: readonly AttackOutcome[];
}

/** Сообщение для scanInput (один user-message). */
export function userText(text: string): readonly ChatMessage[] {
  return [{ role: 'user', content: text }];
}
