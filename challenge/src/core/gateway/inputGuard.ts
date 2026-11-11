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
  stripInvisible,
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
 * Нормализация для detection-view: NFKC уже сделан, но остаются
 * 1) percent-encoding внутри слова (`Ign%6fre`),
 * 2) кириллические/греческие двойники латиницы, которые NFKC не сворачивает,
 * 3) leetspeak (`1gn0r3`),
 * 4) любые разделители между словами (эмодзи, точки, подчёркивания).
 * На исходный текст и на то, что уходит в модель, это не влияет.
 */
const HOMOGLYPH_MAP: Readonly<Record<string, string>> = {
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  у: 'y',
  х: 'x',
  і: 'i',
  ј: 'j',
  ѕ: 's',
  ԁ: 'd',
  ɡ: 'g',
  α: 'a',
  ε: 'e',
  ι: 'i',
  κ: 'k',
  ν: 'v',
  ο: 'o',
  ρ: 'p',
  τ: 't',
  υ: 'u',
  χ: 'x',
};
const HOMOGLYPH_RE = new RegExp(`[${Object.keys(HOMOGLYPH_MAP).join('')}]`, 'gu');
const LEET_MAP: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
};

function decodePercent(text: string): string {
  // Максимальные %XX-серии декодируем как UTF-8 (кириллица), а не по байту.
  // Две итерации закрывают double-encoding (%2569 → %69 → i).
  let out = text;
  for (let i = 0; i < 2; i += 1) {
    out = out.replace(/(?:%[0-9a-fA-F]{2})+/g, (run) => {
      try {
        return decodeURIComponent(run);
      } catch {
        return run;
      }
    });
  }
  return out;
}

function canonicalView(text: string, foldHomoglyphs: boolean): string {
  const decoded = decodePercent(normalizeText(text)).normalize('NFKC').toLowerCase();
  let folded = decoded.replace(/[013457@$]/g, (c) => LEET_MAP[c] ?? c);
  if (foldHomoglyphs) folded = folded.replace(HOMOGLYPH_RE, (c) => HOMOGLYPH_MAP[c] ?? c);
  // Любая последовательность не-букв/не-цифр — граница слова. Это закрывает
  // «ignore.all.previous…», «Ignore 🙂 all 🙂 previous…» и
  // «ignore_previous_instructions()» одним правилом.
  return folded.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * Вклеенный view: внутрисловные разделители (дефис, точка, zero-width,
 * combining mark) удаляются, а пробелы между словами сохраняются.
 * `pre-vious` / `prev\u200bious` → `previous`, при этом `ignore all` остаётся
 * двумя словами. Дополняет spaced-view, который ловит `ignore.all`.
 */
function gluedView(text: string, foldHomoglyphs: boolean): string {
  const chars = [...stripInvisible(decodePercent(text).normalize('NFKD')).replace(/\p{M}+/gu, '')];
  const isAlnum = (c: string): boolean => /[\p{L}\p{N}]/u.test(c);
  let out = '';
  let last = '';
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i]!;
    if (/\s/u.test(ch)) {
      out += ' ';
      last = ' ';
      continue;
    }
    if (!isAlnum(ch)) {
      // Удаляем всю серию не-алфанумерик символов (без пробелов): `pre--vious`,
      // `pre·-vious`. Пробел остаётся границей слова, поэтому `ignore all`
      // не склеивается в `ignoreall`.
      let j = i;
      while (j < chars.length && !isAlnum(chars[j]!) && !/\s/u.test(chars[j]!)) j += 1;
      const next = chars[j] ?? '';
      if (isAlnum(last) && isAlnum(next)) {
        i = j - 1;
        continue;
      }
      out += ' ';
      last = ' ';
      continue;
    }
    out += ch;
    last = ch;
  }
  let view = out.replace(/\s+/g, ' ').trim().toLowerCase();
  view = view.replace(/[013457@$]/g, (c) => LEET_MAP[c] ?? c);
  if (foldHomoglyphs) view = view.replace(HOMOGLYPH_RE, (c) => HOMOGLYPH_MAP[c] ?? c);
  return view.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Role-spoof view: сохраняет синтаксис токена, но убирает invisible/combining. */
function roleSpoofView(text: string): string {
  return stripInvisible(decodePercent(text).normalize('NFKD')).replace(/\p{M}+/gu, '');
}

/**
 * Detection-view: базовый (кириллица сохранена), homoglyph-folded,
 * и вклеенные варианты для внутрисловных разделителей. Дубликаты убираются.
 */
function instructionViews(text: string): string[] {
  const views = [
    canonicalView(text, false),
    canonicalView(text, true),
    gluedView(text, false),
    gluedView(text, true),
  ];
  return [...new Set(views)];
}

/**
 * Узкие jailbreak-паттерны. Входят в общий набор; отдельно по ним
 * system-сообщения больше не сканируются — system проходит полный набор,
 * как и user/assistant.
 */
const JAILBREAK_PATTERNS: readonly InstructionPattern[] = [
  {
    re: /(?:^|\s)(?:you\s+are\s+(?:now\s+)?dan|act\s+as\s+dan|(?:веди|представь)\s+себя\s+как\s+dan)\b[^\n]{0,40}(?:no\s+(?:limits|rules|restrictions)|without\s+(?:limits|rules|restrictions)|anything|unfiltered|без\s+ограничений|do\s+anything\s+now)|\bdan\s+mode\b[^\n]{0,40}(?:enabled|on|activate|no\s+restrictions?|без\s+ограничений)|do\s+anything\s+now\s+mode\b/gi,
    kind: 'prompt_injection',
    label: 'jailbreak: DAN / do anything now',
  },
  {
    re: /(?:режим\s+разработчика|developer\s+mode)[^\n]{0,80}(?:без\s+цензуры|без\s+ограничений|no\s+restrictions?)/gi,
    kind: 'prompt_injection',
    label: 'jailbreak: developer mode без ограничений',
  },
  {
    // Только явная цель-политика: «remove filters from the dashboard» — не атака.
    re: /(?:отключи|сними|убери)\s+(?:все\s+)?(?:предыдущие\s+)?(?:ограничения|цензуру)|(?:disable|remove)\s+(?:your\s+|all\s+|the\s+model'?s?\s+)(?:safety|content|security)\s+(?:restrictions?|filters?|guardrails?)/gi,
    kind: 'prompt_injection',
    label: 'jailbreak: отключение ограничений',
  },
];

/**
 * Role spoof через служебные токены чата: <|im_start|>system, <|system|>,
 * <<SYS>>, [INST] (RT-95, round-4). Требуем назначение роли, а не просто
 * упоминание токена: «what is <|im_start|>?» остаётся allow.
 */
const ROLE_SPOOF_PATTERN: InstructionPattern = {
  re: /<\s*\|\s*im_start\s*\|\s*>\s*(?:system|developer)\b|<\s*\|\s*system\s*\|\s*>|<<SYS>>|\[\/?INST\]/gi,
  kind: 'role_spoof',
  label: 'role spoof: служебные токены чата в данных',
};

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
    // Смешанный алфавит: русский глагол + английский хвост и наоборот.
    re: /(?:ignore|disregard|forget|игнорир[а-яё]*|проигнорир[а-яё]*|забудь|забыть)\s+(?:all\s+|все\s+)?(?:previous|prior|above|earlier|предыдущие|прошлые)\s+(?:instructions?|prompts?|rules?|инструкц[а-яё]*|правил[а-яё]*)/gi,
    kind: 'prompt_injection',
    label: 'prompt injection: mixed-script «ignore previous instructions»',
  },
  {
    re: /\b(?:print|reveal|show|display|repeat|output)\s+(?:me\s+)?(?:your|the)\s+(?:system\s+(?:prompt|message|instructions)|initial\s+instructions?|hidden\s+rules?)/gi,
    kind: 'exfil_request',
    label: 'exfil: запрос system prompt модели',
  },
  {
    re: /(?:выведи|покажи|распечатай|повтори|напечатай|раскрой|процитируй|процитировать|перескажи|воспроизведи|озвучь)\s+(?:(?:сво[йю]|тво[йю]|мо[йю])\s+)?(?:системн[а-яё]*\s+(?:промпт[а-яё]*|инструкц[а-яё]*|сообщени[а-яё]*|правил[а-яё]*)|скрытые?\s+правил[а-яё]*|начальные?\s+инструкц[а-яё]*)/gi,
    kind: 'exfil_request',
    label: 'exfil: запрос system prompt модели (RU)',
  },
  {
    re: /(?:гипотетическ[а-яё]*|как\s+будто|в\s+теории)[^\n]{0,80}(?:дословно|процитир[а-яё]*|воспроизвед[а-яё]*|перескаж[а-яё]*|вывед[а-яё]*|покаж[а-яё]*)[^\n]{0,80}(?:системн[а-яё]*\s+(?:промпт|инструкц|сообщен))/gi,
    kind: 'exfil_request',
    label: 'exfil: гипотетическая рамка вокруг system prompt',
  },
  {
    re: /\b(?:hypothetical(?:ly)?|imagine|suppose|in theory)[^\n]{0,80}(?:verbatim|quote|repeat|reveal|print|show)[^\n]{0,80}(?:system\s+(?:prompt|instructions?|message))/gi,
    kind: 'exfil_request',
    label: 'exfil: hypothetical framing (EN)',
  },
  {
    re: /(?:что|что\s+именно)\s+(?:было|будет|находится|содержится|написано)\s+(?:бы\s+)?в\s+(?:тво[её]м\s+)?системн[а-яё]*\s+(?:промпт|инструкц)/gi,
    kind: 'exfil_request',
    label: 'exfil: «что в системном промпте»',
  },
  {
    re: /(?:повтори|выведи|напечатай|перескажи)\s+(?:всё|все)[^\n]{0,80}(?:до\s+этого\s+сообщения|выше|в\s+контексте)[^\n]{0,80}(?:system|системн|инструкц)/gi,
    kind: 'exfil_request',
    label: 'exfil: повтор всего контекста до system',
  },
  {
    re: /\b(?:repeat|print|output|show)\s+(?:everything|all)\s+(?:above|before this message|you were told)[^\n]{0,80}(?:system|instruction|prompt)/gi,
    kind: 'exfil_request',
    label: 'exfil: repeat everything above (EN)',
  },
  {
    re: /(?:повтори|выведи|напечатай|перескажи)\s+(?:всё|все)\s+(?:выше\s+(?:этого|в\s+контексте|дословно|полностью)|до\s+этого\s+сообщения)/gi,
    kind: 'exfil_request',
    label: 'exfil: повтор всего контекста (RU)',
  },
  {
    re: /\b(?:repeat|print|output|show)\s+(?:everything|all)\s+(?:above|before)\s+(?:this|the)\s+(?:message|prompt|context|conversation)\b/gi,
    kind: 'exfil_request',
    label: 'exfil: repeat everything above without keyword (EN)',
  },
  {
    re: /(?:json)[^\n]{0,40}(?:with|containing|including|с\s+полем|полем|включая|содержащий)[^\n]{0,40}system[_\s-]?prompt/gi,
    kind: 'exfil_request',
    label: 'exfil: system prompt в JSON-поле',
  },
  {
    re: /^(?:please\s+)?(?:reconstruct|decode|assemble)\s+(?:the\s+|an?\s+)?(?:api[_\s-]?key|token|secret|password)\s+from\s+(?:hex|base64|ascii|bytes?|codes?|numbers?)/gi,
    kind: 'exfil_request',
    label: 'exfil: сборка секрета из кодировки (EN)',
  },
  {
    re: /^(?:пожалуйста,?\s+)?(?:собери|восстанови|декодируй|расшифруй)\s+(?:мне\s+)?(?:ключ|токен|секрет|пароль)[^\n]{0,80}(?:из|с)\s+(?:hex|base64|ascii|байт|кодов|массив|чисел)/gi,
    kind: 'exfil_request',
    label: 'exfil: сборка секрета из кодировки (RU)',
  },
  ...JAILBREAK_PATTERNS,
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
  ROLE_SPOOF_PATTERN,
];

/** Паттерны, которым нужен исходный синтаксис токенов, а не слова: склейка
 *  `<|im_start|>` разделителями ломает их, поэтому сканируем raw-view. */
const RAW_INSTRUCTION_PATTERNS: readonly InstructionPattern[] = [ROLE_SPOOF_PATTERN];

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

/** «never reveal…», «do not print…» — политика, а не запрос на exfil. */
function isNegatedRequest(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 28), index).toLowerCase();
  // Без голого «not»: после canonical-view «Actually, not: print…» выглядит
  // как «actually not print…», и такой обход не должен отключать детекцию.
  // canonical-view схлопывает апостроф: «don't» → «don t», поэтому \s*.
  return /(?:never|don\s*t|do\s+not|не)\s*$/i.test(before);
}

function matchInstructionPatterns(
  text: string,
  patterns: readonly InstructionPattern[] = INSTRUCTION_PATTERNS,
): InstructionFinding[] {
  const out: InstructionFinding[] = [];
  for (const p of patterns) {
    for (const m of text.matchAll(p.re)) {
      // Негативная политика в user/assistant-истории — FP, не атака
      // (audit F9). Только для exfil: «Never <|im_start|>system» — всё ещё
      // role spoof, а «Do not ignore previous instructions» всё ещё инструкция.
      if (p.kind === 'exfil_request' && isNegatedRequest(text, m.index)) continue;
      out.push(findingForInstruction(p, m[0], m.index));
    }
  }
  return out;
}

/**
 * Инструкции во вводе: по каждому сообщению, по склейке data-сообщений
 * (split между message, RT-96) и по base64/base32-декодам до глубины 2
 * (decode-and-scan, RT-96; audit follow-up). Клиентский `role: system`
 * сканируется тем же полным набором: для gateway это данные, а не
 * приложение-владелец промпта. Негативная политика («never reveal…»)
 * отсекается `isNegatedRequest`.
 * Дубликаты схлопываются по kind+label.
 */
export function scanInstructions(messages: readonly ChatMessage[]): InstructionFinding[] {
  const out: InstructionFinding[] = [];
  const seen = new Set<string>();
  const add = (finding: InstructionFinding): void => {
    const key = `${finding.kind}|${finding.label}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(finding);
  };

  const scanText = (text: string): void => {
    for (const view of instructionViews(text)) {
      for (const f of matchInstructionPatterns(view)) add(f);
    }
    // Role-spoof токены требуют исходного синтаксиса; canonical-view их ломает.
    for (const f of matchInstructionPatterns(roleSpoofView(text), RAW_INSTRUCTION_PATTERNS)) add(f);
    for (const decoded of decodeLayers(text)) {
      for (const view of instructionViews(decoded)) {
        for (const f of matchInstructionPatterns(view)) add(f);
      }
      for (const f of matchInstructionPatterns(roleSpoofView(decoded), RAW_INSTRUCTION_PATTERNS)) add(f);
    }
  };

  const dataMessages = messages.filter((m) => m.role !== 'system');
  for (const message of dataMessages) scanText(message.content);
  // Для инструкций склейка через пробел: «Ignore all previous» + «instructions»
  // должны дать фразу, даже если слова разрезаны по границе сообщений.
  if (dataMessages.length > 1) scanText(dataMessages.map((m) => m.content).join(' '));

  for (const message of messages.filter((m) => m.role === 'system')) {
    scanText(message.content);
  }
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
