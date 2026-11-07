// Детекция и маскирование секретов/ПДн на границе LLM-gateway (ADVANCED day-13).
//
// Инвариант: наружу и в audit-логи попадают только kind/severity/preview —
// сырое значение секрета никогда не покидает этот модуль.
// Детекторы чистые, без I/O. Обфускация проверяется декодированием и повторным
// сканом с ограничением глубины: base64 (включая двойной, url-safe и с
// пробелами), base32, split-конкатенация ('a'+'b', [a,b].join(''), a.concat(b),
// template literal), hex/unicode-escape, percent-encoding, plain-hex строка,
// hex-байты с пробелами, NFKC/fullwidth, String.fromCodePoint,
// Buffer.from([bytes]), невидимые символы (zero-width/BOM) внутри литерала.
// Round-4 (day-15 RT-82..RT-89): split между сообщениями сканируется по
// склейке — иначе один секрет, разрезанный на два message, проходит мимо
// per-message сканера.

import type { ChatMessage } from '../types.js';

// Default_Ignorable покрывает zero-width/BOM/soft hyphen/variation selectors/
// tag-characters — не только короткий список U+200B..U+200F.
const DEFAULT_IGNORABLE_RE = /\p{Default_Ignorable_Code_Point}/gu;

/** Убрать невидимые кодовые точки (code-point aware, включая astral tags). */
export function stripInvisible(text: string): string {
  return text.replace(DEFAULT_IGNORABLE_RE, '');
}

/** NFKC + удаление невидимых — общая нормализация для guard/backstop. */
export function normalizeUnicode(text: string): string {
  return stripInvisible(text.normalize('NFKC'));
}

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
  | 'base32_secret'
  | 'split_secret'
  | 'hex_secret';

export type SecretSeverity = 'critical' | 'high' | 'medium';

export type DetectionVia = 'direct' | 'base64' | 'base32' | 'split' | 'hex';

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

// Точки-разделители карты (4242.4242.4242.4242) — RT-88, round-4. Luhn-гейт
// держит точность: версии/даты без контрольной суммы не считаются картой.
const CARD_RE = /\b(?:\d[ .-]?){12,18}\d\b/g;
const PHONE_RE =
  /(?:\+\d{1,3}[\s-]?(?:\(?\d{2,4}\)?[\s-]?)?\d{3}[\s-]?\d{2}[\s-]?\d{2,4}|\b[78][\s(-]?\d{3}[\s)-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b)/g;
// - и _ включены: base64url-токены («секрет» может быть не-ASCII) сканируются
// так же, как стандартные; Node-декодер base64 принимает url-safe алфавит.
const BASE64_RE = /(?<![A-Za-z0-9+/\-_])[A-Za-z0-9+/\-_]{16,}={0,2}(?![A-Za-z0-9+/\-_=])/g;
// Base32 (RFC 4648) case-insensitive: lowercase — валидный RFC-вариант, но
// раньше детектор его не видел. RT-83, round-4 (audit follow-up).
const BASE32_RE = /(?<![A-Za-z2-7])[A-Za-z2-7]{16,}={0,6}(?![A-Za-z2-7=])/g;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Максимальная глубина рекурсивного декодирования (base64/base32 и т.п.). */
const MAX_DECODE_DEPTH = 3;

interface SplitCandidate {
  readonly label: string;
  readonly re: RegExp;
  /** Собранная («склеенная») строка из групп матча; null — кандидат не про конкатенацию. */
  readonly joined: (groups: readonly (string | undefined)[]) => string | null;
}

/**
 * Кандидаты на split-обфускацию секрета в коде: 'a' + 'b' (в т.ч. цепочки),
 * [a,b].join(''), a.concat(b), template literal с ${…}, String.fromCharCode,
 * reverse-цепочка, строка с пробелами внутри, ROT13-строка.
 * Каждый кандидат матчится по оригинальному тексту, чтобы находку можно
 * было точно замаскировать. Точность держится на scanJoined: находка
 * засчитывается, только если расшифрованная строка реально содержит секрет
 * (в любой кодировке) — FP-safe по построению.
 */
const SPLIT_CANDIDATES: readonly SplitCandidate[] = [
  {
    label: 'quoted concat chain',
    re: /((["'])([^"'\n]*)\2(?:\s*\+\s*(["'])([^"'\n]*)\4)+)/g,
    joined: (g) => {
      // Цепочка из 2+ строк через +: склеиваем все строковые сегменты матча.
      const segs = [...(g[0] ?? '').matchAll(/(["'])([^"']*)\1/g)].map((x) => x[2] ?? '');
      return segs.length >= 2 ? segs.join('') : null;
    },
  },
  {
    // 2+ элементов: старый regex знал только два, трёхэлементный join
    // проходил (RT-84, round-4). Сепаратор — только пустой: join(',') не
    // склеивает секрет, а ложную находку на нём давать нельзя.
    label: 'array join',
    re: /\[\s*((?:(['"])[^"'\n]*\2\s*,\s*)+(['"])[^"'\n]*\3)\s*\]\s*\.\s*join\s*\(\s*(['"])\4\s*\)/g,
    joined: (g) => {
      const segs = [...(g[1] ?? '').matchAll(/(["'])([^"']*)\1/g)].map((x) => x[2] ?? '');
      return segs.length >= 2 ? segs.join('') : null;
    },
  },
  {
    label: 'concat call',
    re: /(["'])([^"']*)\1\s*\.\s*concat\s*\(\s*(["'])([^"']*)\3/g,
    joined: (g) => `${g[2] ?? ''}${g[4] ?? ''}`,
  },
  {
    label: 'fromCharCode',
    re: /String\.fromCharCode\(\s*\d{1,7}(?:\s*,\s*\d{1,7}){7,}\s*\)/g,
    joined: (g) => decodeCharCodes(g[0] ?? ''),
  },
  {
    // String.fromCodePoint — та же идея другим API (RT-85, round-4).
    label: 'fromCodePoint',
    re: /String\.fromCodePoint\(\s*\d{1,7}(?:\s*,\s*\d{1,7}){7,}\s*\)/g,
    joined: (g) => decodeCharCodes(g[0] ?? ''),
  },
  {
    // Байтовый литерал: Buffer.from([115,107,…]).toString() (RT-86, round-4).
    label: 'byte array literal',
    re: /(?:Buffer\.from|new\s+Uint8Array|Uint8Array)\s*\(\s*\[\s*(\d{1,3}(?:\s*,\s*\d{1,3}){7,})\s*\]\s*\)/g,
    joined: (g) => {
      const nums = (g[1] ?? '').split(',').map((x) => Number(x.trim()));
      if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
      const decoded = Buffer.from(nums).toString('utf8');
      return isPrintable(decoded) ? decoded : null;
    },
  },
  {
    label: 'reversed string',
    re: /(["'])([^"'\n]{8,})\1\s*\.\s*split\s*\(\s*(["'])\s*\3\s*\)\s*\.\s*reverse\s*\(\s*\)\s*\.\s*join\s*\(\s*(["'])\s*\4\s*\)/g,
    joined: (g) => [...(g[2] ?? '')].reverse().join(''),
  },
  {
    label: 'rot13 string',
    re: /(["'])([A-Za-z]{12,})\1/g,
    joined: (g) =>
      (g[2] ?? '').replace(/[a-zA-Z]/g, (c) => {
        const base = c <= 'Z' ? 65 : 97;
        return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
      }),
  },
  {
    // Пробелы И невидимые символы (zero-width, BOM): «секрет в одну строку,
    // но с невидимой начинкой». RT-68, round-3 red team.
    label: 'string with inner whitespace/invisible chars',
    re: /(["'])([^"'\n]{16,})\1/g,
    joined: (g) => {
      const s = g[2] ?? '';
      const stripped = stripInvisible(s).replace(/\s+/g, '');
      return stripped === s ? null : stripped;
    },
  },
  {
    // NFKC/fullwidth: "ｓｋ－…" + .normalize("NFKC") (RT-82, round-4).
    // Сканируется нормализованный вид; находка только если в нём есть секрет.
    label: 'NFKC-normalized string',
    re: /(["'])([^"'\n]{12,})\1/g,
    joined: (g) => {
      const s = g[2] ?? '';
      const normalized = normalizeUnicode(s);
      return normalized === s ? null : normalized;
    },
  },
  {
    // Hex-байты с пробелами: Buffer.from("73 6b 2d …", "hex") (RT-87).
    label: 'hex bytes with separators',
    re: /(["'])((?:[0-9a-fA-F]{2}[\s]+){7,}[0-9a-fA-F]{2})\1/g,
    joined: (g) => {
      const hex = (g[2] ?? '').replace(/\s+/g, '');
      if (hex.length % 2 !== 0) return null;
      const decoded = Buffer.from(hex, 'hex').toString('utf8');
      return isPrintable(decoded) ? decoded : null;
    },
  },
  {
    // Plain-hex строка: Buffer.from('736b2d…','hex') без эскейпов — HEX_SEQ_RE
    // с \x-префиксами её не видел. RT-66, round-3 red team. FP-safe: находка
    // засчитывается только если декод содержит реальный секрет (scanSecrets).
    label: 'hex string literal',
    re: /(["'])([0-9a-fA-F]{16,})\1/g,
    joined: (g) => {
      const s = g[2] ?? '';
      if (s.length % 2 !== 0) return null;
      const bytes = Buffer.from(s, 'hex');
      const decoded = bytes.toString('utf8');
      return bytes.length > 0 && isPrintable(decoded) ? decoded : null;
    },
  },
  {
    label: 'template literal',
    re: /`([^`\\]{4,240})`/g,
    joined: (g) => {
      const content = g[1] ?? '';
      return content.includes('${') ? content.replace(/\$\{[^}]{0,32}\}/g, '') : null;
    },
  },
];

const HEX_SEQ_RE = /(?:\\x[0-9a-fA-F]{2}){8,}/g;
const UNICODE_SEQ_RE = /(?:\\u\{?[0-9a-fA-F]{2,4}\}?){8,}/g;
// Percent-encoding: %73%6b%2d… — секрет, спрятанный в URL-параметре
// (RT-67, round-3 red team).
const PERCENT_SEQ_RE = /(?:%[0-9a-fA-F]{2}){8,}/g;

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
  base32: '[REDACTED_BASE32_SECRET]',
  split: '[REDACTED_SPLIT_SECRET]',
  hex: '[REDACTED_HEX_SECRET]',
} as const;

function previewFor(kind: SecretKind, raw: string): string {
  const s = raw.trim();
  if (kind === 'email') return 'e***@e***';
  if (kind === 'card') return `**** **** **** ${s.replace(/\D/g, '').slice(-4)}`;
  if (kind === 'phone') return s.slice(0, 2) + '***' + s.slice(-2);
  if (kind === 'private_key') return '[PRIVATE KEY BLOCK]';
  if (s.length <= 8) return '***';
  // Только короткий префикс: 4+2 символа на 10-12-символьном токене —
  // это >50% значения в audit/422 (audit P3 follow-up).
  return `${s.slice(0, 3)}***`;
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
    // matchAll: рекурсивные вызовы scanSecrets внутри циклов не сбивают
    // lastIndex общего regex (реентерабельность).
    for (const m of text.matchAll(d.re)) {
      const raw = d.group ? (m[d.group] ?? m[0]) : m[0];
      out.push(finding(d, raw, m.index));
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
  for (const m of text.matchAll(CARD_RE)) {
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
  for (const m of text.matchAll(PHONE_RE)) {
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

/** Коды символов из String.fromCharCode/fromCodePoint → строка (или null). */
function decodeCharCodes(raw: string): string | null {
  const codes = raw.match(/\d{1,7}/g) ?? [];
  let out = '';
  for (const c of codes) {
    const n = Number(c);
    if (!Number.isFinite(n) || n < 0x20 || n > 0x10ffff) return null;
    out += String.fromCodePoint(n);
  }
  return out;
}

/** Base32 (RFC 4648) → строка; null, если декод не печатный. */
function decodeBase32(token: string): string | null {
  const clean = token.replace(/=+$/, '').toUpperCase();
  if (clean.length < 16) return null;
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (bytes.length === 0) return null;
  const decoded = Buffer.from(bytes).toString('utf8');
  return isPrintable(decoded) ? decoded : null;
}

/** Base32-токены, декодирующиеся в секрет (RT-83, round-4). */
function findBase32(text: string, depth: number): SecretFinding[] {
  const out: SecretFinding[] = [];
  for (const m of text.matchAll(BASE32_RE)) {
    const decoded = decodeBase32(m[0]);
    if (!decoded) continue;
    const inner = depth < MAX_DECODE_DEPTH ? scanSecrets(decoded, depth + 1) : [];
    if (inner.length === 0) continue;
    out.push(
      finding(
        {
          kind: 'base32_secret',
          label: `base32(${inner[0]!.label})`,
          severity: inner[0]!.severity,
          redaction: REDACTION.base32,
        },
        m[0],
        m.index,
        'base32',
      ),
    );
  }
  return out;
}

/** base32, разорванный пробелами/переносами: склейка с картой индексов. */
function findBase32Whitespace(text: string, depth: number): SecretFinding[] {
  if (!/\s/.test(text)) return [];
  const chars: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (/\s/.test(text[i]!)) continue;
    chars.push(text[i]!);
    map.push(i);
  }
  const normalized = chars.join('');
  const out: SecretFinding[] = [];
  for (const m of normalized.matchAll(BASE32_RE)) {
    const decoded = decodeBase32(m[0]);
    if (!decoded) continue;
    const inner = depth < MAX_DECODE_DEPTH ? scanSecrets(decoded, depth + 1) : [];
    if (inner.length === 0) continue;
    const start = map[m.index] ?? 0;
    const last = map[m.index + m[0].length - 1] ?? start;
    out.push(
      finding(
        {
          kind: 'base32_secret',
          label: `base32-ws(${inner[0]!.label})`,
          severity: inner[0]!.severity,
          redaction: REDACTION.base32,
        },
        text.slice(start, last + 1),
        start,
        'base32',
      ),
    );
  }
  return out;
}

function findBase64(text: string, depth: number): SecretFinding[] {
  const out: SecretFinding[] = [];
  for (const m of text.matchAll(BASE64_RE)) {
    const token = m[0];
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    if (!isPrintable(decoded)) continue;
    // Рекурсия с ограничением глубины ловит double-base64.
    const inner = depth < MAX_DECODE_DEPTH ? scanSecrets(decoded, depth + 1) : [];
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

/** base64, разорванный пробелами/переносами: склеиваем с картой обратных индексов. */
function findBase64Whitespace(text: string, depth: number): SecretFinding[] {
  if (!/\s/.test(text)) return [];
  const chars: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (/\s/.test(text[i]!)) continue;
    chars.push(text[i]!);
    map.push(i);
  }
  const normalized = chars.join('');
  const out: SecretFinding[] = [];
  for (const m of normalized.matchAll(BASE64_RE)) {
    const token = m[0];
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    if (!isPrintable(decoded)) continue;
    const inner = depth < MAX_DECODE_DEPTH ? scanSecrets(decoded, depth + 1) : [];
    if (inner.length === 0) continue;
    const start = map[m.index] ?? 0;
    const last = map[m.index + token.length - 1] ?? start;
    // Длина в оригинале — от первого до последнего символа токена.
    out.push(
      finding(
        { kind: 'base64_secret', label: `base64-ws(${inner[0]!.label})`, severity: inner[0]!.severity, redaction: REDACTION.base64 },
        text.slice(start, last + 1),
        start,
        'base64',
      ),
    );
  }
  return out;
}

/** hex/unicode-escape/percent-последовательности, собирающиеся в секрет. */
function findEscaped(text: string, depth: number): SecretFinding[] {
  const out: SecretFinding[] = [];
  for (const re of [HEX_SEQ_RE, UNICODE_SEQ_RE, PERCENT_SEQ_RE]) {
    for (const m of text.matchAll(re)) {
      const decoded = decodeEscaped(m[0]);
      if (decoded.length < 4) continue;
      const inner = depth < MAX_DECODE_DEPTH ? scanSecrets(decoded, depth + 1) : [];
      if (inner.length === 0) continue;
      out.push(
        finding(
          { kind: 'hex_secret', label: `escaped(${inner[0]!.label})`, severity: inner[0]!.severity, redaction: REDACTION.hex },
          m[0],
          m.index,
          'hex',
        ),
      );
    }
  }
  return out;
}

/** Декодирует \xNN / \uNNNN(…) / %NN-последовательность в строку; невалидный токен — '' */
function decodeEscaped(raw: string): string {
  let out = '';
  const tokenRe = /\\x([0-9a-fA-F]{2})|\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})|%([0-9a-fA-F]{2})/g;
  for (const m of raw.matchAll(tokenRe)) {
    const hex = m[1] ?? m[2] ?? m[3] ?? m[4];
    if (!hex) return '';
    const code = parseInt(hex, 16);
    if (!Number.isFinite(code) || code < 0x20 || code > 0x10ffff) return '';
    out += String.fromCodePoint(code);
  }
  return out;
}

function scanJoined(joined: string, depth: number): SecretFinding[] {
  return scanSecrets(joined, depth + 1);
}

function findSplit(text: string, depth: number): SecretFinding[] {
  const out: SecretFinding[] = [];
  for (const candidate of SPLIT_CANDIDATES) {
    for (const m of text.matchAll(candidate.re)) {
      const joined = candidate.joined(m);
      if (!joined) continue;
      const inner = scanJoined(joined, depth);
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
  }
  return out;
}
/** Убирает находки, чьи спаны полностью перекрыты более длинными (base64-ws поверх base64 и т.п.). */
function dedupeOverlaps(findings: readonly SecretFinding[]): SecretFinding[] {
  const sorted = [...findings].sort((a, b) => a.index - b.index || b.length - a.length);
  const out: SecretFinding[] = [];
  for (const f of sorted) {
    const last = out[out.length - 1];
    if (last && f.index < last.index + last.length && last.index < f.index + f.length) continue;
    out.push(f);
  }
  return out;
}

/** Все находки в строке, включая base64-, split- и escape-обфускацию. */
export function scanSecrets(text: string, depth = 0): SecretFinding[] {
  const direct = findDirect(text);
  const cards = findCards(text);
  const phones = findPhones(text, cards);
  const deep = depth < MAX_DECODE_DEPTH;
  return dedupeOverlaps([
    ...direct,
    ...cards,
    ...phones,
    ...(deep ? findBase64(text, depth) : []),
    ...(deep ? findBase32(text, depth) : []),
    ...(deep ? findBase64Whitespace(text, depth) : []),
    ...(deep ? findBase32Whitespace(text, depth) : []),
    ...(deep ? findEscaped(text, depth) : []),
    ...(deep ? findSplit(text, depth) : []),
  ]);
}

export interface MessageSecretFinding extends SecretFinding {
  readonly messageIndex: number;
  /** Находка собрана из нескольких сообщений: маскировать нельзя — block. */
  readonly crossMessage?: boolean;
}

export function scanMessages(messages: readonly ChatMessage[]): MessageSecretFinding[] {
  const out: MessageSecretFinding[] = [];
  messages.forEach((message, messageIndex) => {
    for (const f of scanSecrets(message.content)) {
      out.push({ ...f, messageIndex });
    }
  });

  // Cross-message split (RT-89, round-4): per-message скан не видит секрет,
  // разрезанный на два message. Склеиваем без разделителя — модель получает
  // контекст сообщений подряд, значит и проверять надо ту же склейку.
  if (messages.length < 2) return out;
  const starts: number[] = [];
  let cursor = 0;
  for (const message of messages) {
    starts.push(cursor);
    cursor += message.content.length;
  }
  const joined = messages.map((m) => m.content).join('');
  for (const f of scanSecrets(joined)) {
    const messageIndex = messageStartIndex(starts, f.index);
    if (messageIndex < 0) continue;
    const start = starts[messageIndex]!;
    const content = messages[messageIndex]!.content;
    const index = f.index - start;
    const length = Math.min(f.length, content.length - index);
    if (length <= 0) continue;
    // Важно проверить пересечение границы ДО duplicate-проверки: первый
    // фрагмент секрета может сам быть валидным матчем (audit follow-up).
    const crossesBoundary = f.index + f.length > start + content.length;
    if (!crossesBoundary) {
      const duplicate = out.some(
        (x) =>
          x.messageIndex === messageIndex &&
          x.index === index &&
          x.kind === f.kind &&
          Math.abs(x.length - length) <= 2,
      );
      if (duplicate) continue;
    }
    out.push({ ...f, messageIndex, index, length, crossMessage: true });
  }
  return out;
}

/** Индекс сообщения, в которое попадает глобальная позиция. */
function messageStartIndex(starts: readonly number[], index: number): number {
  for (let i = starts.length - 1; i >= 0; i -= 1) {
    if (index >= starts[i]!) return i;
  }
  return -1;
}

/** Заменяет матчи, для которых decide вернул замену; спаны собираются заранее. */
function replaceWhen(
  text: string,
  re: RegExp,
  decide: (m: RegExpMatchArray) => string | null,
): string {
  const spans: Array<{ start: number; end: number; redaction: string }> = [];
  for (const m of text.matchAll(re)) {
    const redaction = decide(m);
    if (redaction === null) continue;
    spans.push({ start: m.index, end: m.index + m[0].length, redaction });
  }
  let out = text;
  for (const span of spans.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, span.start) + span.redaction + out.slice(span.end);
  }
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
  // replaceWhen: callback вызывает scanSecrets → рекурсия в тот же regex,
  // поэтому замена не через replace-коллбэк, а по заранее собранным спанам.
  out = replaceWhen(out, BASE64_RE, (m) => {
    const decoded = Buffer.from(m[0], 'base64').toString('utf8');
    if (!isPrintable(decoded)) return null;
    return scanSecrets(decoded, 1).length > 0 ? REDACTION.base64 : null;
  });
  out = replaceWhen(out, BASE32_RE, (m) => {
    const decoded = decodeBase32(m[0]);
    if (!decoded) return null;
    return scanSecrets(decoded, 1).length > 0 ? REDACTION.base32 : null;
  });
  for (const candidate of SPLIT_CANDIDATES) {
    out = replaceWhen(out, candidate.re, (m) => {
      const joined = candidate.joined(m);
      if (!joined) return null;
      return scanJoined(joined, 0).length > 0 ? REDACTION.split : null;
    });
  }
  out = maskWhitespaceBase64(out);
  out = maskWhitespaceBase32(out);
  out = replaceWhen(out, HEX_SEQ_RE, (m) => {
    const decoded = decodeEscaped(m[0]);
    return decoded.length >= 4 && scanSecrets(decoded, 1).length > 0 ? REDACTION.hex : null;
  });
  out = replaceWhen(out, UNICODE_SEQ_RE, (m) => {
    const decoded = decodeEscaped(m[0]);
    return decoded.length >= 4 && scanSecrets(decoded, 1).length > 0 ? REDACTION.hex : null;
  });
  out = replaceWhen(out, PERCENT_SEQ_RE, (m) => {
    const decoded = decodeEscaped(m[0]);
    return decoded.length >= 4 && scanSecrets(decoded, 1).length > 0 ? REDACTION.hex : null;
  });
  return out;
}

/** Маскирует base32, разорванный пробелами/переносами (карта индексов). */
function maskWhitespaceBase32(text: string): string {
  if (!/\s/.test(text)) return text;
  const chars: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (/\s/.test(text[i]!)) continue;
    chars.push(text[i]!);
    map.push(i);
  }
  const normalized = chars.join('');
  const spans: Array<{ start: number; end: number }> = [];
  for (const m of normalized.matchAll(BASE32_RE)) {
    const decoded = decodeBase32(m[0]);
    if (!decoded) continue;
    if (scanSecrets(decoded, 1).length === 0) continue;
    const start = map[m.index] ?? 0;
    const last = map[m.index + m[0].length - 1] ?? start;
    spans.push({ start, end: last + 1 });
  }
  let out = text;
  for (const span of spans.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, span.start) + REDACTION.base32 + out.slice(span.end);
  }
  return out;
}

/** Маскирует base64, разорванный пробелами/переносами (замена по карте индексов). */
function maskWhitespaceBase64(text: string): string {
  if (!/\s/.test(text)) return text;
  const chars: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (/\s/.test(text[i]!)) continue;
    chars.push(text[i]!);
    map.push(i);
  }
  const normalized = chars.join('');
  const spans: Array<{ start: number; end: number }> = [];
  for (const m of normalized.matchAll(BASE64_RE)) {
    const token = m[0];
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    if (!isPrintable(decoded)) continue;
    if (scanSecrets(decoded, 1).length === 0) continue;
    const start = map[m.index] ?? 0;
    const last = map[m.index + token.length - 1] ?? start;
    spans.push({ start, end: last + 1 });
  }
  let out = text;
  for (const span of spans.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, span.start) + REDACTION.base64 + out.slice(span.end);
  }
  return out;
}

/** Маскирует каждый message и возвращает копию массива. */
export function maskMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.map((m) => ({ ...m, content: maskSecrets(m.content) }));
}

export interface DecodedBase64Token {
  readonly token: string;
  readonly index: number;
  readonly decoded: string;
}

/** Печатные base64-токены с исходными позициями (decode-and-scan инструкций). */
export function findDecodedBase64Tokens(text: string): DecodedBase64Token[] {
  const out: DecodedBase64Token[] = [];
  for (const m of text.matchAll(BASE64_RE)) {
    const decoded = Buffer.from(m[0], 'base64').toString('utf8');
    if (isPrintable(decoded)) out.push({ token: m[0], index: m.index, decoded });
  }
  return out;
}

/** Печатные base64-токены в декодированном виде (для проверки утечек и обфускации). */
export function decodeBase64Tokens(text: string): string[] {
  return findDecodedBase64Tokens(text).map((t) => t.decoded);
}

export interface DecodedBase32Token {
  readonly token: string;
  readonly index: number;
  readonly decoded: string;
}

/** Печатные base32-токены с позициями (проверка утечек system prompt). */
export function findDecodedBase32Tokens(text: string): DecodedBase32Token[] {
  const out: DecodedBase32Token[] = [];
  for (const m of text.matchAll(BASE32_RE)) {
    const decoded = decodeBase32(m[0]);
    if (decoded) out.push({ token: m[0], index: m.index, decoded });
  }
  return out;
}

/**
 * Многослойные base64/base32-декоды без позиций: для decode-and-scan
 * инструкций (RT-96/RT-97 audit follow-up). Ограничения защищают от
 * экспоненциального взрыва на большом вводе.
 */
export function decodeLayers(
  text: string,
  maxDepth = 2,
  maxViews = 32,
  maxChars = 16_000,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let frontier: string[] = [text];
  for (let depth = 1; depth <= maxDepth && out.length < maxViews; depth += 1) {
    const next: string[] = [];
    for (const source of frontier) {
      const decodedTokens = [
        ...findDecodedBase64Tokens(source).map((t) => t.decoded),
        ...findDecodedBase32Tokens(source).map((t) => t.decoded),
      ];
      for (const decoded of decodedTokens) {
        if (decoded.length > maxChars || seen.has(decoded)) continue;
        seen.add(decoded);
        out.push(decoded);
        next.push(decoded);
        if (out.length >= maxViews) break;
      }
      if (out.length >= maxViews) break;
    }
    frontier = next;
  }
  return out;
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
