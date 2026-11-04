// Модули недели security (ADVANCED days 11–12): direct и indirect prompt injection + защитные слои.

export {
  normalizeText,
  containsAny,
  refuses,
  hasCanary,
  leaksSystemPrompt,
  bankTarget,
  mediumTarget,
  hardenedBankTarget,
  hardenedMediumTarget,
  defaultAttacks,
  runInjectionAttacks,
  summarizeByTechnique,
} from './injectionLab.js';
export type {
  ChatFn,
  InjectionTarget,
  InjectionTechnique,
  AttackDifficulty,
  InjectionAttack,
  AttackResult,
  RunLabOptions,
} from './injectionLab.js';

export {
  stripZeroWidth,
  stripHtmlComments,
  stripExecutableTags,
  stripHiddenStyledTags,
  stripMarkdownHiddenPayloads,
  unwrapRemainingTags,
  dropZeroWidthBlocks,
  sanitizeExternal,
  BOUNDARY_RULES,
  wrapExternalContent,
  validateOutput,
} from './contentDefense.js';
export type { OutputValidation } from './contentDefense.js';

export {
  emailVector,
  documentVector,
  webSearchVector,
  copilotCodeVector,
  defaultVectors,
  allVectors,
  prepareIndirectPrompt,
  runIndirectAttack,
  runIndirectMatrix,
} from './indirectLab.js';
export type {
  IndirectVector,
  DefenseMode,
  IndirectRunOptions,
  IndirectAttackResult,
  PreparedIndirectPrompt,
} from './indirectLab.js';

export {
  RED_TEAM_TECHNIQUES,
  classifyInput,
  canariesFromText,
  analyzeResponse,
  decideVerdict,
  verdictTitle,
  emptyStats,
  applyVerdict,
} from './redTeamChat.js';
export type {
  RedTeamTechnique,
  TechniqueHit,
  AttackClassification,
  ResponseAnalysis,
  RedTeamVerdict,
  RedTeamStats,
} from './redTeamChat.js';

export {
  RED_TEAM_CASES,
  GLOSSARY,
  TECHNIQUE_HINTS,
  promptVariants,
  findPromptVariant,
  findRedTeamCase,
  nextUntriedCase,
  findGlossaryEntry,
  topicHint,
  coachHint,
} from './redTeamCases.js';
export type {
  CaseKind,
  RedTeamCase,
  PromptDifficulty,
  PromptVariant,
  GlossaryEntry,
  CoachContext,
} from './redTeamCases.js';

export {
  ALL_DEFENSE_MODES,
  defaultDay11Targets,
  isHardenedTarget,
  runDay11Demo,
  runDay12Demo,
  runSecurityDemo,
  parseDemoDay,
  day11ChatSteps,
  day12ChatSteps,
} from './securityDemo.js';
export type {
  DemoDay,
  DemoBucket,
  Day11ProfileResult,
  Day11DemoReport,
  Day11DemoOptions,
  Day12DemoReport,
  Day12DemoOptions,
  SecurityDemoOptions,
  SecurityDemoReport,
  Day11ChatStep,
  Day12ChatStep,
} from './securityDemo.js';
