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
  runIndirectAttack,
  runIndirectMatrix,
} from './indirectLab.js';
export type {
  IndirectVector,
  DefenseMode,
  IndirectRunOptions,
  IndirectAttackResult,
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
