// Публичный API LLM-gateway (ADVANCED day-13).

export { guardInput, DEFAULT_GUARD_MODE } from './inputGuard.js';
export type {
  GuardMode,
  InputGuardOptions,
  InputGuardAction,
  InputGuardResult,
} from './inputGuard.js';

export { guardOutput, summarizeOutputFindings } from './outputGuard.js';
export type {
  OutputFinding,
  OutputFindingKind,
  OutputGuardOptions,
  OutputGuardAction,
  OutputGuardResult,
} from './outputGuard.js';

export {
  scanSecrets,
  scanMessages,
  maskSecrets,
  maskMessages,
  summarizeFindings,
  REDACTION,
} from './secrets.js';
export type {
  SecretKind,
  SecretSeverity,
  DetectionVia,
  SecretFinding,
  MessageSecretFinding,
  FindingSummary,
} from './secrets.js';

export { IpRateLimiter } from './rateLimit.js';
export type { RateLimitDecision } from './rateLimit.js';

export {
  DEFAULT_PRICES,
  priceForModel,
  costForUsage,
  CostTracker,
} from './cost.js';
export type { ModelPrice, CostBreakdown } from './cost.js';

export {
  JsonlAuditLog,
  JsonlInterceptedLog,
  MemoryAuditLog,
  MemoryInterceptedLog,
  safePreview,
} from './auditLog.js';
export type {
  AuditStatus,
  AuditFinding,
  AuditRecord,
  AuditSink,
  InterceptedRecord,
  InterceptedSink,
} from './auditLog.js';

export { callUpstream, defaultFetch, UpstreamError } from './upstream.js';
export type { FetchFn, UpstreamChatRequest, UpstreamChatResult } from './upstream.js';

export { createGateway, startGateway } from './server.js';
export type {
  GatewayServerOptions,
  GatewayStats,
  GatewayHandle,
  RunningGateway,
} from './server.js';

export {
  GATEWAY_TEST_CASES,
  runCaseMatrix,
  matrixSummary,
} from './cases.js';
export type {
  CaseDirection,
  GatewayTestCase,
  CaseResult,
} from './cases.js';
