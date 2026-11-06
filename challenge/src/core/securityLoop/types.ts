// Контракты execution loop с security-шагом (ADVANCED day-14).
//
// Loop не знает про HTTP gateway и провайдера: он получает LlmCaller, который
// обязан ходить только через LLM Gateway. Это позволяет тестировать оркестрацию
// без сети и гарантирует единственный LLM-путь в production.

import type { ChatMessage } from '../types.js';

/** Стек, под который строится security-промпт. */
export type StackProfile = 'android' | 'ios' | 'web' | 'generic';

export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low';

export type LoopStage = 'generation' | 'security_review';

export type GatewayDirection = 'input' | 'output';

/** Безопасная находка gateway: только kind/severity/preview, без сырых значений. */
export interface GatewayFinding {
  readonly kind: string;
  readonly severity: string;
  readonly preview: string;
  readonly via?: string;
}

/** Что gateway сообщил о конкретном вызове. */
export interface GatewayCallInfo {
  readonly stage: LoopStage;
  readonly requestId: string | null;
  readonly input: 'allow' | 'masked';
  readonly output: 'allow' | 'redacted';
  readonly warning: string | null;
  readonly costUsd: number | null;
}

export interface LlmCallOptions {
  readonly stage?: LoopStage;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly model?: string;
}

export interface LlmResult {
  readonly content: string;
  readonly info: GatewayCallInfo;
}

/** Единственный LLM-путь loop. Реализация — GatewayClient. */
export interface LlmCaller {
  chat(messages: readonly ChatMessage[], opts?: LlmCallOptions): Promise<LlmResult>;
}

export interface RequiredPattern {
  readonly label: string;
  readonly re: RegExp;
}

export type TaskScenario = 'security' | 'gateway-leak';

/** Задача, которую loop прогоняет от промпта до коммита. */
export interface CodeTask {
  readonly id: string;
  readonly title: string;
  readonly prompt: string;
  readonly stack: StackProfile;
  readonly fileName: string;
  readonly scenario: TaskScenario;
  /** Данные кодовой базы; считаются данными, не инструкциями. */
  readonly context?: string;
  /** Контрактные проверки тестового шага (символы/структура). */
  readonly requiredPatterns: readonly RequiredPattern[];
}

/** Нормализованная находка security review. */
export interface SecurityFinding {
  readonly severity: SecuritySeverity;
  readonly category: string;
  readonly line: number | null;
  readonly title: string;
  /** Всегда проходит maskSecrets: в лог не попадает сырое значение. */
  readonly evidence: string;
  readonly recommendation: string;
}

export interface SecurityReview {
  readonly summary: string;
  readonly findings: readonly SecurityFinding[];
}

export interface SecurityDecision {
  readonly action: 'commit' | 'commit_with_warning' | 'regenerate';
  readonly blocking: readonly SecurityFinding[];
  readonly warnings: readonly SecurityFinding[];
}

export interface TestCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}

export interface TestResult {
  readonly ok: boolean;
  readonly checks: readonly TestCheck[];
}

export interface TestRunner {
  run(code: string, task: CodeTask): Promise<TestResult>;
}

export interface CommitInput {
  readonly runId: string;
  readonly task: CodeTask;
  readonly attempt: number;
  readonly code: string;
  readonly review: SecurityReview;
  readonly warnings: readonly SecurityFinding[];
  readonly gatewayCalls: readonly GatewayCallInfo[];
}

export interface CommitResult {
  readonly ok: boolean;
  readonly sha?: string;
  readonly dir?: string;
  readonly message: string;
}

export interface Committer {
  commit(input: CommitInput): Promise<CommitResult>;
}

export type LoopEventType =
  | 'run_start'
  | 'task_start'
  | 'generation_start'
  | 'generation_result'
  | 'tests_result'
  | 'security_review_start'
  | 'security_review_result'
  | 'security_decision'
  | 'security_regenerate'
  | 'gateway_blocked'
  | 'commit'
  | 'task_end'
  | 'run_end';

export interface LoopEvent {
  readonly ts: string;
  readonly runId: string;
  readonly taskId: string | null;
  readonly attempt: number | null;
  readonly type: LoopEventType;
  readonly message: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface LoopLogger {
  log(event: LoopEvent): void;
}

export type TaskStatus =
  | 'committed'
  | 'committed_with_warning'
  | 'rejected_security'
  | 'blocked_gateway_input'
  | 'blocked_gateway_output'
  | 'review_error'
  | 'error';

export interface GatewayCounters {
  readonly clean: number;
  readonly masked: number;
  readonly redacted: number;
  readonly blockedInput: number;
  readonly blockedOutput: number;
}

export interface SecurityCounts {
  readonly critical: number;
  readonly high: number;
  readonly medium: number;
  readonly low: number;
}

export interface TaskReport {
  readonly taskId: string;
  readonly title: string;
  readonly scenario: TaskScenario;
  readonly stack: StackProfile;
  readonly status: TaskStatus;
  readonly attempts: number;
  readonly llmCalls: number;
  readonly gateway: GatewayCounters;
  readonly gatewayCalls: readonly GatewayCallInfo[];
  readonly security: SecurityCounts;
  readonly findings: readonly SecurityFinding[];
  readonly commit?: CommitResult;
  readonly codeHash: string | null;
  readonly codeLines: number | null;
  readonly notes: readonly string[];
}

export interface RunTotals {
  readonly tasks: number;
  readonly committed: number;
  readonly committedWithWarning: number;
  readonly rejected: number;
  readonly gatewayBlocked: number;
  readonly errors: number;
  readonly llmCalls: number;
  readonly cleanCalls: number;
  readonly blockedInput: number;
  readonly blockedOutput: number;
  readonly warnings: number;
  readonly blockingFindings: number;
}

export interface RunReport {
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly gatewayUrl: string;
  readonly tasks: readonly TaskReport[];
  readonly totals: RunTotals;
}
