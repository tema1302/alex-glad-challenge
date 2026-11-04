// Детекция и маскирование секретов/ПДн на границе LLM-gateway (ADVANCED day-13).
//
// Инвариант: наружу и в audit-логи попадают только kind/severity/preview —
// сырое значение секрета никогда не покидает этот модуль.
// Детекторы чистые, без I/O. Base64-кодированные и «разбитые» секреты
// проверяются нормализацией и повторным сканом.

import type { ChatMessage } from '../types.js';

export type SecretKind =
  | 'api_key'
  | 'github_token'
  | 'aws_key'
  | 'google_key'
  | 'slack_token'
  | 'jwt'
  | 'bearer'
  | 'private_key'
  | 'email'
  | 'card'
  | 'phone'
  | 'base64_secret'
  | 'split_secret';

export type SecretSeverity = 'critical' | 'high' | 'medium';

export type DetectionVia = 'direct' | 'base64' | 'split';

export interface SecretFinding {
  readonly kind: SecretKind;
  readonly label: string;
  readonly severity: SecretSeverity;
  /** Безопасный фрагмент для логов: никогда не содержит полного значения. */
  readonly preview: string;
  readonly redaction: string;
  readonly index: number;
  /** Длина исходного матча (для проверки перекрытий карта/телефон). */
  readonly length: number;
  readonly via: DetectionVia;
}

interface Detector {
  readonly kind: SecretKind;
  readonly label: string;
  readonly severity: SecretSeverity;
  readonly re: RegExp;
  readonly redaction: string;
  /** Группа regexp для замены; 0 — весь матч. */
  readonly group?: number;
}

const DETECTORS: readonly Detector[] = [
  {
    kind: 'private_key',
    label: 'private key block',
    severity: 'critical',
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
    redaction: '[REDACTED_PRIVATE_KEY]',
  },
  {
    kind: 'api_key',
    label: 'OpenAI/Anthropic-style key',
    severity: 'critical',
    re: /\bsk-(?:(?:proj|ant|live|test)-[A-Za-z0-9_-]{4,}|[A-Za-z0-9]{20,})\b/g,
    redaction: '[REDACTED_API_KEY]',
  },
  {
    kind: 'github_token',
    label: 'GitHub token',
    severity: 'critical',
    re: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
    redaction: '[REDACTED_GITHUB_TOKEN]',
  },
  {
    kind: 'aws_key',
    label: 'AWS access key',
    severity: 'critical',
    re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    redaction: '[REDACTED_AWS_KEY]',
  },
  {
    kind: 'google_key',
    label: 'Google API key',
    severity: 'critical',
    re: /\bAIza[0-9A-Za-z_-]{20,}\b/g,
    redaction: '[REDACTED_GOOGLE_KEY]',
  },
  {
    kind: 'slack_token',
    label: 'Slack token',
    severity: 'critical',
    re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
    redaction: '[REDACTED_SLACK_TOKEN]',
  },
  {
    kind: 'jwt',
    label: 'JWT',
    severity: 'high',
    re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    redaction: '[REDACTED_JWT]',
  },
  {
    kind: 'bearer',
    label: 'Bearer token',
    severity: 'critical',
    re: /\bBearer\s+([A-Za-z0-9._~+/-]{12,}=*)/gi,
    redaction: '[REDACTED_BEARER_TOKEN]',
    group: 1,
  },
  {
    kind: 'email',
    label: 'email address',
    severity: 'medium',
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    redaction: '[REDACTED_EMAIL]',
  },
];

const CARD_RE = /\b(?:\d[ -]?){12,18}\d\b/g;
const PHONE_RE =
  /(?:\+\d{1,3}[\s-]?(?:\(?\d{2,4}\)?[\s-]?)?\d{3}[\s-]?\d{2}[\s-]?\d{2,4}|\b[78][\s(-]?\d{3}[\s)-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b)/g;
const BASE64_RE = /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{16,}={0,2}(?![A-Za-z0-9+/=])/g;
const SPLIT_EXPR_RE = /(["'])([^"']*)\1\s*\+\s*(["'])([^"']*)\3/g;

export const REDACTION = {
  apiKey: '[REDACTED_API_KEY]',
  github: '[REDACTED_GITHUB_TOKEN]',
  aws: '[REDACTED_AWS_KEY]',
  google: '[REDACTED_GOOGLE_KEY]',
  slack: '[REDACTED_SLACK_TOKEN]',
  jwt: '[REDACTED_JWT]',
  bearer: '[REDACTED_BEARER_TOKEN]',
  privateKey: '[REDACTED_PRIVATE_KEY]',
  email: '[REDACTED_EMAIL]',
  card: '[REDACTED_CARD]',
  phone: '[REDACTED_PHONE]',
  base64: '[REDACTED_BASE64_SECRET]',
  split: '[REDACTED_SPLIT_SECRET]',
} as const;

function previewFor(kind: SecretKind, raw: string): string {
  const s = raw.trim();
  if (kind === 'email') return 'e***@e***';
  if (kind === 'card') return `**** **** **** ${s.replace(/\D/g, '').slice(-4)}`;
  if (kind === 'phone') return s.slice(0, 2) + '***' + s.slice(-2);
  if (kind === 'private_key') return '[PRIVATE KEY BLOCK]';
  if (s.length <= 8) return '***';
  return `${s.slice(0, 4)}***${s.slice(-2)}`;
}

function finding(
  detector: Pick<Detector, 'kind' | 'label' | 'severity' | 'redaction'>,
  raw: string,
  index: number,
  via: DetectionVia = 'direct',
): SecretFinding {
  return {
    kind: detector.kind,
    label: detector.label,
    severity: detector.severity,
    preview: previewFor(detector.kind, raw),
    redaction: detector.redaction,
    index,
    length: raw.length,
    via,
  };
}

function findDirect(text: string): SecretFinding[] {
  const out: SecretFinding[] = [];
  for (const d of DETECTORS) {
    d.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = d.re.exec(text)) !== null) {
      const raw = d.group ? (m[d.group] ?? m[0]) : m[0];
      out.push(finding(d, raw, m.index));
      if (m[0].length === 0) d.re.lastIndex += 1;
    }
  }
  return out;
}

function isLuhnValid(digits: string): boolean {
  let sum = 0;
  let doubleIt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = digits.charCodeAt(i) - 48;
    if (doubleIt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    doubleIt = !doubleIt;
  }
  return sum > 0 && sum % 10 === 0;
}

function findCards(text: string): SecretFinding[] {
  const out: SecretFinding[] = [];
  CARD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CARD_RE.exec(text)) !== null) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) continue;
    if (!isLuhnValid(digits)) continue;
    out.push(finding({ kind: 'card', label: 'card number', severity: 'high', redaction: REDACTION.card }, m[0], m.index));
  }
  return out;
}

function overlaps(findings: readonly SecretFinding[], start: number, end: number): boolean {
  return findings.some((f) => f.index < end && start < f.index + f.length);
}

function findPhones(text: string, cardFindings: readonly SecretFinding[]): SecretFinding[] {
  const out: SecretFinding[] = [];
  PHONE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PHONE_RE.exec(text)) !== null) {
    if (overlaps(cardFindings, m.index, m.index + m[0].length)) continue;
    out.push(
      finding({ kind: 'phone', label: 'phone number', severity: 'medium', redaction: REDACTION.phone }, m[0], m.index),
    );
  }
  return out;
}

function isPrintable(s: string): boolean {
  if (s.length < 6) return false;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 && ch !== '\n' && ch !== '\t' && ch !== '\r') return false;
    if (code === 0xfffd) return false;
  }
  return true;
}

function findBase64(text: string): SecretFinding[] {
  const out: SecretFinding[] = [];
  BASE64_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BASE64_RE.exec(text)) !== null) {
    const token = m[0];
    if (!isPrintable(Buffer.from(token, 'base64').toString('utf8'))) continue;
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const inner = [...findDirect(decoded), ...findCards(decoded)];
    if (inner.length === 0) continue;
    out.push(
      finding(
        { kind: 'base64_secret', label: `base64(${inner[0]!.label})`, severity: inner[0]!.severity, redaction: REDACTION.base64 },
        token,
        m.index,
        'base64',
      ),
    );
  }
  return out;
}

function normalizeSplit(text: string): string {
  return text.replace(/(["'])\s*\+\s*(["'])/g, '');
}

function findSplit(text: string): SecretFinding[] {
  const out: SecretFinding[] = [];
  const normalized = normalizeSplit(text);
  const directOnNormalized = [...findDirect(normalized), ...findCards(normalized)];
  if (directOnNormalized.length === 0) return out;

  SPLIT_EXPR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SPLIT_EXPR_RE.exec(text)) !== null) {
    const joined = `${m[2] ?? ''}${m[4] ?? ''}`;
    const inner = [...findDirect(joined), ...findCards(joined)];
    if (inner.length === 0) continue;
    out.push(
      finding(
        {
          kind: 'split_secret',
          label: `split(${inner[0]!.label})`,
          severity: inner[0]!.severity,
          redaction: REDACTION.split,
        },
        m[0],
        m.index,
        'split',
      ),
    );
  }
  return out;
}

/** Все находки в строке, включая base64- и split-обфускацию. */
export function scanSecrets(text: string): SecretFinding[] {
  const direct = findDirect(text);
  const cards = findCards(text);
  const phones = findPhones(text, cards);
  return [...direct, ...cards, ...phones, ...findBase64(text), ...findSplit(text)];
}

export interface MessageSecretFinding extends SecretFinding {
  readonly messageIndex: number;
}

export function scanMessages(messages: readonly ChatMessage[]): MessageSecretFinding[] {
  const out: MessageSecretFinding[] = [];
  messages.forEach((message, messageIndex) => {
    for (const f of scanSecrets(message.content)) {
      out.push({ ...f, messageIndex });
    }
  });
  return out;
}

/** Заменяет все найденные секреты на безопасные маркеры. */
export function maskSecrets(text: string): string {
  let out = text;
  for (const d of DETECTORS) {
    out = out.replace(d.re, (...args: unknown[]) => {
      const groups = args.slice(0, -2) as string[];
      const whole = groups[0] ?? '';
      if (!d.group) return d.redaction;
      const g = groups[d.group] ?? whole;
      return whole.replace(g, d.redaction);
    });
  }
  out = out.replace(CARD_RE, (m) => {
    const digits = m.replace(/\D/g, '');
    return digits.length >= 13 && digits.length <= 19 && isLuhnValid(digits) ? REDACTION.card : m;
  });
  out = out.replace(PHONE_RE, REDACTION.phone);
  out = out.replace(BASE64_RE, (m) => {
    const decoded = Buffer.from(m, 'base64').toString('utf8');
    if (!isPrintable(decoded)) return m;
    const inner = [...findDirect(decoded), ...findCards(decoded)];
    return inner.length > 0 ? REDACTION.base64 : m;
  });
  out = out.replace(SPLIT_EXPR_RE, (whole, _q1: string, part1: string, _q2: string, part2: string) => {
    const inner = [...findDirect(`${part1}${part2}`), ...findCards(`${part1}${part2}`)];
    return inner.length > 0 ? REDACTION.split : whole;
  });
  return out;
}

/** Маскирует каждый message и возвращает копию массива. */
export function maskMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.map((m) => ({ ...m, content: maskSecrets(m.content) }));
}

/** Сводка для логов: только kind/severity/preview, без сырых значений. */
export interface FindingSummary {
  readonly kind: SecretKind;
  readonly severity: SecretSeverity;
  readonly preview: string;
  readonly via: DetectionVia;
}

export function summarizeFindings(findings: readonly SecretFinding[]): FindingSummary[] {
  return findings.map(({ kind, severity, preview, via }) => ({ kind, severity, preview, via }));
}
