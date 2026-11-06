// Red team (ADVANCED day-15): набор атак по своему пайплайну, офлайн.
//
// Цель — проверять детерминированный слой защиты до боя с партнёром.
// Все «взломанные» LLM — scripted, сеть не нужна; секреты в кейсах фейковые.

export { PipelineTarget } from './target.js';
export { ATTACK_CASES } from './cases.js';
export { runRedTeam } from './runner.js';
export type { RunRedTeamOptions } from './runner.js';
export type {
  AttackCase,
  AttackOutcome,
  AttackTarget,
  CaseKind,
  GenerationVerdict,
  RedTeamReport,
  RedTeamTotals,
  RedTeamVector,
  ReviewStageVerdict,
  ScanVerdict,
} from './types.js';
