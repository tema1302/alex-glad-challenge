// Output Guard (ADVANCED day-13): проверка ответа модели до выдачи пользователю.
//
// Ловит: сгенерированные секреты (в т.ч. галлюцинированные ключи), утечку
// system prompt, подозрительные URL и shell-команды.
// critical → ответ блокируется; high/medium → фрагмент редактируется.
// Наружу — только безопасные маркеры, без сырых значений.

import { decodeBase64Tokens, scanSecrets, type SecretFinding, type SecretKind } from './secrets.js';

export type OutputFindingKind =
  | SecretKind
  | 'system_prompt_leak'
  | 'suspicious_url'
  | 'suspicious_command';

export interface OutputFinding {
  readonly kind: OutputFindingKind;
  readonly label: string;
  readonly severity: 'critical' | 'high' | 'medium';
  readonly preview: string;
  readonly index: number;
  readonly length: number;
  readonly redaction: string;
}

export interface OutputGuardOptions {
  /** System prompt запроса: если ответ содержит его дословно — утечка. */
  readonly systemPrompt?: string;
}

export type OutputGuardAction = 'allow' | 'redacted' | 'blocked';

export interface OutputGuardResult {
  readonly action: OutputGuardAction;
  readonly findings: readonly OutputFinding[];
  readonly text: string;
  readonly warning: string | null;
}

const SENSITIVE_SECRETS: ReadonlySet<SecretKind> = new Set<SecretKind>([
  'api_key',
  'github_token',
  'aws_key',
  'google_key',
  'slack_token',
  'jwt',
  'bearer',
  'private_key',
  'card',
  'base64_secret',
  'split_secret',
  'hex_secret',
]);

const URL_RE = /\b(?:https?|ftp|file|javascript|data):[^\s<>"'`)\]]+/gi;
const SHORTENERS = new Set([
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'is.gd',
  'cutt.ly',
  'rb.gy',
  'ow.ly',
  'buff.ly',
]);

const COMMAND_PATTERNS: ReadonlyArray<RegExp> = [
  // Trailing \b после несловесных символов (/, ~, *) никогда не матчится —
  // голое «rm -rf /» проходило насквозь (RT-36, round-2 red team).
  /\brm\s+-rf\s+(?:\/|~|\*|\$HOME)/gi,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/g,
  /\b(?:curl|wget)\b[^\n|]{0,200}\|\s*(?:sudo\s+)?(?:ba)?sh\b/gi,
  /\bbase64\s+(?:-d|--decode)\b[^\n|]{0,120}\|\s*(?:ba)?sh\b/gi,
  /\bpowershell(?:\.exe)?\b[^\n]{0,120}-(?:enc|encodedcommand)\b/gi,
  /\bchild_process\b/g,
  /\bos\.system\s*\(/g,
  /\bsubprocess\.[A-Za-z]+\([^\n)]*shell\s*=\s*True/g,
  /\bnc\s+-e\s+\/(?:bin\/)?(?:ba)?sh\b/gi,
  /\bchmod\s+777\s+\//g,
];

const LEAK_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:here(?:'s| is)|reveal(?:ing)?|print(?:ing)?|display(?:ing)?|show(?:ing)?|leak(?:ing)?)\s+(?:my|the)\s+system\s+(?:prompt|message)\b/gi,
  /\bmy\s+system\s+(?:prompt|message)\s+(?:is|was|says)\b/gi,
  /(?:вот|показываю|вывожу|раскрываю)\s+(?:мой\s+)?системн\w*\s+промпт\w*/gi,
  /системн\w*\s+промпт\s*[:—-]\s*\S+/gi,
];

function normalizeForLeak(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function secretToOutput(f: SecretFinding): OutputFinding {
  const critical = SENSITIVE_SECRETS.has(f.kind);
  return {
    kind: f.kind,
    label: f.label,
    severity: critical ? 'critical' : 'medium',
    preview: f.preview,
    index: f.index,
    length: f.length,
    redaction: f.redaction,
  };
}

function leakingSystemPrompt(response: string, systemPrompt?: string): OutputFinding | null {
  const hay = normalizeForLeak(response);
  if (systemPrompt && systemPrompt.trim().length >= 24) {
    const needle = normalizeForLeak(systemPrompt);
    const needleHead = needle.slice(0, 200);
    // base64-декодированные токены ответа: утечка «в base64» ловится так же,
    // как дословная (head-префикс покрывает разбивку на короткие куски без
    // вставок; куски с разделителями остаются за статическими проверками).
    const decoded = decodeBase64Tokens(response).map(normalizeForLeak);
    const containsNeedle = (text: string): boolean =>
      text.includes(needle) || (needleHead.length >= 40 && text.includes(needleHead));
    if (containsNeedle(hay) || decoded.some(containsNeedle)) {
      return {
        kind: 'system_prompt_leak',
        label: 'verbatim system prompt',
        severity: 'critical',
        preview: '[SYSTEM PROMPT VERBATIM]',
        index: Math.max(0, response.toLowerCase().indexOf(needle.slice(0, Math.min(20, needle.length)))),
        length: 0,
        redaction: '[BLOCKED_SYSTEM_PROMPT_LEAK]',
      };
    }
  }
  for (const re of LEAK_PATTERNS) {
    re.lastIndex = 0;
    const m = re.exec(response);
    if (m) {
      return {
        kind: 'system_prompt_leak',
        label: 'system prompt disclosure phrase',
        severity: 'critical',
        preview: '[SYSTEM PROMPT DISCLOSURE]',
        index: m.index,
        length: m[0].length,
        redaction: '[BLOCKED_SYSTEM_PROMPT_LEAK]',
      };
    }
  }
  return null;
}

function classifyUrl(raw: string): OutputFinding | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const scheme = url.protocol.toLowerCase();
  const host = url.hostname.toLowerCase();
  const highRisk =
    scheme === 'javascript:' ||
    scheme === 'data:' ||
    scheme === 'file:' ||
    host === '169.254.169.254' ||
    host.startsWith('xn--') ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ||
    SHORTENERS.has(host) ||
    url.username.length > 0 ||
    (url.port !== '' && url.port !== '80' && url.port !== '443');
  const mediumRisk = scheme === 'http:' && !['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
  if (!highRisk && !mediumRisk) return null;
  return {
    kind: 'suspicious_url',
    label: highRisk ? 'high-risk URL' : 'non-TLS URL',
    severity: highRisk ? 'high' : 'medium',
    preview: `${scheme}//${host}/…`,
    index: 0,
    length: raw.length,
    redaction: '[SUSPICIOUS_URL]',
  };
}

function findUrls(text: string): OutputFinding[] {
  const out: OutputFinding[] = [];
  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    const f = classifyUrl(m[0]);
    if (f) out.push({ ...f, index: m.index });
  }
  return out;
}

function findCommands(text: string): OutputFinding[] {
  const out: OutputFinding[] = [];
  for (const re of COMMAND_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      out.push({
        kind: 'suspicious_command',
        label: 'destructive/remote-exec command',
        severity: 'high',
        preview: m[0].replace(/\s+/g, ' ').slice(0, 40),
        index: m.index,
        length: m[0].length,
        redaction: '[SUSPICIOUS_COMMAND]',
      });
      if (m[0].length === 0) re.lastIndex += 1;
    }
  }
  return out;
}

function applyRedactions(text: string, findings: readonly OutputFinding[]): string {
  const applicable = findings
    .filter((f) => f.length > 0 && f.kind !== 'system_prompt_leak')
    .sort((a, b) => b.index - a.index);
  let out = text;
  for (const f of applicable) {
    out = out.slice(0, f.index) + f.redaction + out.slice(f.index + f.length);
  }
  return out;
}

function warningFor(findings: readonly OutputFinding[], action: OutputGuardAction): string | null {
  if (findings.length === 0) return null;
  const kinds = [...new Set(findings.map((f) => f.kind))].join(', ');
  return action === 'blocked'
    ? `Output Guard: ответ заблокирован — обнаружено (${kinds}).`
    : `Output Guard: опасные фрагменты заменены (${kinds}).`;
}

export function guardOutput(
  response: string,
  opts: OutputGuardOptions = {},
): OutputGuardResult {
  const findings: OutputFinding[] = [
    ...scanSecrets(response).map(secretToOutput),
    ...findUrls(response),
    ...findCommands(response),
  ];
  const leak = leakingSystemPrompt(response, opts.systemPrompt);
  if (leak) findings.push(leak);

  const blocked = findings.some((f) => f.severity === 'critical' || f.kind === 'system_prompt_leak');
  if (blocked) {
    const warning = warningFor(findings, 'blocked');
    return {
      action: 'blocked',
      findings,
      text: warning ?? '[BLOCKED_BY_OUTPUT_GUARD]',
      warning,
    };
  }

  if (findings.length > 0) {
    const warning = warningFor(findings, 'redacted');
    return { action: 'redacted', findings, text: applyRedactions(response, findings), warning };
  }

  return { action: 'allow', findings, text: response, warning: null };
}

/** Безопасная сводка для audit-лога. */
export function summarizeOutputFindings(findings: readonly OutputFinding[]): Array<{
  kind: OutputFindingKind;
  severity: OutputFinding['severity'];
  preview: string;
}> {
  return findings.map(({ kind, severity, preview }) => ({ kind, severity, preview }));
}
