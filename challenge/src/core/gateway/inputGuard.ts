// Input Guard (ADVANCED day-13): проверка входящего промпта до отправки в LLM.
//
// block — находка любого секрета блокирует запрос (LLM не вызывается);
// mask  — секреты заменяются маркерами, запрос проходит дальше.
// Warning никогда не содержит сырое значение секрета.
//
// Round-3 (day-15 RT-76..RT-78): инструкции-инъекции в пользовательском вводе
// (prompt injection через user message или подложенный файл) сканируются
// отдельно: их нельзя «замаскировать», поэтому block в обоих режимах.
// Паттерны высокоточные — тот же набор семейств, что в backstop.

import type { ChatMessage } from '../types.js';
import {
  decodeLayers,
  maskMessages,
  normalizeText,
  scanMessages,
  summarizeFindings,
  type FindingSummary,
  type MessageSecretFinding,
} from './secrets.js';

export type GuardMode = 'block' | 'mask';

export interface InputGuardOptions {
  readonly mode?: GuardMode;
}

export type InputGuardAction = 'allow' | 'masked' | 'blocked';

export interface InputGuardResult {
  readonly action: InputGuardAction;
  readonly findings: readonly MessageSecretFinding[];
  readonly summary: readonly FindingSummary[];
  /** Инструкции-инъекции во вводе (round-3): block в обоих режимах. */
  readonly instructions: readonly InstructionFinding[];
  readonly instructionSummary: readonly InstructionSummary[];
  /** Сообщения для upstream: исходные (allow) или замаскированные (masked). */
  readonly messages: readonly ChatMessage[];
  readonly warning: string | null;
}

export const DEFAULT_GUARD_MODE: GuardMode = 'block';

// ── Инструкции-инъекции во вводе (round-3, RT-76..RT-78) ──

export type InputInstructionKind = 'prompt_injection' | 'exfil_request' | 'role_spoof';

export interface InstructionFinding {
  readonly kind: InputInstructionKind;
  readonly label: string;
  readonly severity: 'high';
  readonly preview: string;
  readonly index: number;
  readonly length: number;
  readonly redaction: string;
}

export interface InstructionSummary {
  readonly kind: InputInstructionKind;
  readonly severity: 'high';
  readonly preview: string;
}

interface InstructionPattern {
  readonly re: RegExp;
  readonly kind: InputInstructionKind;
  readonly label: string;
}

const REDACTED_INSTRUCTION = '[BLOCKED_INSTRUCTION]';

/**
 * Инструкции к модели, замаскированные под данные: user message или
 * подложенный файл в контексте. Высоко-точные паттерны: конкретные фразы,
 * проверенные FP-тестами на легитимных вопросах про безопасность.
 */
const INSTRUCTION_PATTERNS: readonly InstructionPattern[] = [
  {
    re: /\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|rules?)/gi,
    kind: 'prompt_injection',
    label: 'prompt injection: «ignore previous instructions»',
  },
  {
    re: /(?:игнорир[а-яё]*|проигнорир[а-яё]*|забудь|забыть)\s+(?:все\s+)?(?:предыдущие|прошлые|выше(?:описанные|стоящие)?)\s+(?:инструкц[а-яё]*|указан[а-яё]*|правил[а-яё]*)/gi,
    kind: 'prompt_injection',
    label: 'prompt injection: «игнорируй предыдущие инструкции»',
  },
  {
    re: /\b(?:print|reveal|show|display|repeat|output)\s+(?:me\s+)?(?:your|the)\s+(?:system\s+(?:prompt|message|instructions)|initial\s+instructions?|hidden\s+rules?)/gi,
    kind: 'exfil_request',
    label: 'exfil: запрос system prompt модели',
  },
  {
    re: /(?:выведи|покажи|распечатай|повтори|напечатай|раскрой)\s+(?:свой\s+|твои?\s+)?(?:системн[а-яё]*\s+(?:промпт[а-яё]*|инструкц[а-яё]*|правил[а-яё]*)|скрытые?\s+правил[а-яё]*|начальные?\s+инструкц[а-яё]*)/gi,
    kind: 'exfil_request',
    label: 'exfil: запрос system prompt модели (RU)',
  },
  {
    re: /\b(?:skip|ignore|bypass)\s+(?:the\s+)?security\s+(?:review|check|scan)|security\s+(?:review|ревью)\s+(?:can\s+be\s+)?skipped/gi,
    kind: 'prompt_injection',
    label: 'обход security review во вводе',
  },
  {
    re: /(?:пропусти|пропустить|не\s+делай)\s+(?:security\s*|безопасность,?\s*)?(?:ревью|review|проверку\s+безопасности)/gi,
    kind: 'prompt_injection',
    label: 'обход security review во вводе (RU)',
  },
  {
    // Role spoof через служебные токены чата: <|im_start|>system, <|system|>,
    // <<SYS>>, [INST] (RT-95, round-4). Требуем назначение роли, а не просто
    // упоминание токена: «what is <|im_start|>?» остаётся allow.
    re: /<\|\s*im_start\s*\|>\s*(?:system|developer)\b|<\|\s*system\s*\|>|<<SYS>>|\[\/?INST\]/gi,
    kind: 'role_spoof',
    label: 'role spoof: служебные токены чата в данных',
  },
];

function previewForInstruction(raw: string): string {
  const flat = raw.replace(/\s+/g, ' ').trim();
  return flat.length <= 40 ? flat : `${flat.slice(0, 37)}…`;
}

function findingForInstruction(p: InstructionPattern, raw: string, index: number): InstructionFinding {
  return {
    kind: p.kind,
    label: p.label,
    severity: 'high',
    preview: previewForInstruction(raw),
    index,
    length: raw.length,
    redaction: REDACTED_INSTRUCTION,
  };
}

/**
 * NFKC + удаление невидимых: fullwidth, zero-width и astral math letters не
 * должны обходить фразы. Нормализуем строку целиком (per-code-unit NFKC
 * ломал astral-символы — audit follow-up); точный index не критичен, потому
 * что finding используется только для block/preview.
 */
function instructionView(text: string): string {
  return normalizeText(text);
}

/** «never reveal…», «do not print…» — политика, а не запрос на exfil. */
function isNegatedExfil(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 28), index).toLowerCase();
  return /(?:never|not|don'?t|do\s+not|не)\s*$/i.test(before);
}

function matchInstructionPatterns(text: string): InstructionFinding[] {
  const out: InstructionFinding[] = [];
  for (const p of INSTRUCTION_PATTERNS) {
    for (const m of text.matchAll(p.re)) {
      // Негативная политика в user/assistant-истории — FP, не атака
      // (audit F9). Для prompt_injection/role_spoof фильтр не применяется.
      if (p.kind === 'exfil_request' && isNegatedExfil(text, m.index)) continue;
      out.push(findingForInstruction(p, m[0], m.index));
    }
  }
  return out;
}

/**
 * Инструкции во вводе: по каждому data-сообщению, по склейке сообщений
 * (split между message, RT-96) и по base64/base32-декодам до глубины 2
 * (decode-and-scan, RT-96; audit follow-up). Системный промпт — легитимный
 * канал инструкций, поэтому не сканируется: иначе стандартная фраза
 * «never reveal your system prompt» блокировала бы каждый запрос.
 * Дубликаты схлопываются по kind+label+preview.
 */
export function scanInstructions(messages: readonly ChatMessage[]): InstructionFinding[] {
  const out: InstructionFinding[] = [];
  const seen = new Set<string>();
  const add = (finding: InstructionFinding): void => {
    const key = `${finding.kind}|${finding.label}|${finding.preview}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(finding);
  };

  const scanText = (text: string): void => {
    for (const f of matchInstructionPatterns(instructionView(text))) add(f);
    for (const decoded of decodeLayers(text)) {
      for (const f of matchInstructionPatterns(instructionView(decoded))) add(f);
    }
  };

  const dataMessages = messages.filter((m) => m.role !== 'system');
  for (const message of dataMessages) scanText(message.content);
  // Для инструкций склейка через пробел: «Ignore all previous» + «instructions»
  // должны дать фразу, даже если слова разрезаны по границе сообщений.
  if (dataMessages.length > 1) scanText(dataMessages.map((m) => m.content).join(' '));
  return out;
}

function summarizeInstructions(instructions: readonly InstructionFinding[]): InstructionSummary[] {
  return instructions.map(({ kind, severity, preview }) => ({ kind, severity, preview }));
}

export function guardInput(
  messages: readonly ChatMessage[],
  opts: InputGuardOptions = {},
): InputGuardResult {
  const mode = opts.mode ?? DEFAULT_GUARD_MODE;
  const findings = scanMessages(messages);
  const summary = summarizeFindings(findings);
  // Инструкции — не секрет, «замаскировать» их нельзя: block в обоих режимах.
  const instructions = scanInstructions(messages);
  const instructionSummary = summarizeInstructions(instructions);

  if (findings.length === 0 && instructions.length === 0) {
    return {
      action: 'allow',
      findings,
      summary,
      instructions,
      instructionSummary,
      messages,
      warning: null,
    };
  }

  if (instructions.length > 0) {
    const ikinds = [...new Set(instructions.map((i) => i.kind))].join(', ');
    return {
      action: 'blocked',
      findings,
      summary,
      instructions,
      instructionSummary,
      messages,
      warning:
        `Input Guard: запрос заблокирован, во вводе инструкции-инъекции (${ikinds}). ` +
        'Инструкции к модели должны идти через role: system, а не через данные.',
    };
  }

  // Секрет, разрезанный между сообщениями, нельзя корректно замаскировать
  // per-message: в mask-режиме такой запрос блокируется (RT-89, round-4).
  if (mode === 'mask' && findings.some((f) => f.crossMessage)) {
    return {
      action: 'blocked',
      findings,
      summary,
      instructions,
      instructionSummary,
      messages,
      warning:
        'Input Guard: запрос заблокирован, секрет разрезан между сообщениями и не может быть замаскирован. ' +
        'Отправьте данные одним сообщением или уберите секрет.',
    };
  }

  const kinds = [...new Set(findings.map((f) => f.kind))].join(', ');
  if (mode === 'mask') {
    return {
      action: 'masked',
      findings,
      summary,
      instructions,
      instructionSummary,
      messages: maskMessages(messages),
      warning: `Input Guard: замаскированы секреты (${kinds}). В LLM ушли безопасные маркеры.`,
    };
  }

  return {
    action: 'blocked',
    findings,
    summary,
    instructions,
    instructionSummary,
    messages,
    warning:
      `Input Guard: запрос заблокирован, секреты (${kinds}) не отправлены в LLM. ` +
      'Уберите чувствительные данные или включите режим mask.',
  };
}
