// Публичный API execution loop с security-шагом (ADVANCED day-14).

export {
  GatewayClient,
  GatewayBlockedError,
  GatewayHttpError,
  assertLoopbackGatewayUrl,
} from './gatewayClient.js';
export type { GatewayClientOptions, GatewayFetchFn } from './gatewayClient.js';

export {
  extractCode,
  generationPrompt,
  numberCode,
  securityReviewPrompt,
  securitySystemPrompt,
  STACK_LABELS,
} from './prompt.js';

export {
  classifySecurityReview,
  formatSecurityFeedback,
  gatewayFindingsToSecurity,
  parseSecurityReview,
} from './review.js';
export type { ParseResult } from './review.js';

export { CommandTestRunner, StaticTestRunner } from './tests.js';
export type { CommandTestRunnerOptions } from './tests.js';

export { NoopCommitter, SandboxCommitter } from './commit.js';
export type { SandboxCommitterOptions } from './commit.js';

export {
  evaluateSecurityReview,
  localSecurityFindings,
} from './backstop.js';
export type { EvaluatedSecurityReview } from './backstop.js';

export { JsonlLoopLogger, MemoryLoopLogger, writeJsonReport } from './logger.js';

export { SecurityExecutionLoop } from './loop.js';
export type { SecurityExecutionLoopOptions } from './loop.js';

export { DEMO_TASKS, listDemoTasks, selectDemoTasks } from './cases.js';

export type {
  CodeTask,
  CommitInput,
  CommitResult,
  Committer,
  GatewayCallInfo,
  GatewayCounters,
  GatewayDirection,
  GatewayFinding,
  LlmCallOptions,
  LlmCaller,
  LlmResult,
  LoopEvent,
  LoopEventType,
  LoopLogger,
  LoopStage,
  RequiredPattern,
  RunReport,
  RunTotals,
  SecurityCounts,
  SecurityDecision,
  SecurityFinding,
  SecurityReview,
  SecuritySeverity,
  StackProfile,
  TaskReport,
  TaskScenario,
  TaskStatus,
  TestCheck,
  TestResult,
  TestRunner,
} from './types.js';
