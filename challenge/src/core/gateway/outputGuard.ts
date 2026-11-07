// Output Guard (ADVANCED day-13): проверка ответа модели до выдачи пользователю.
//
// Ловит: сгенерированные секреты (в т.ч. галлюцинированные ключи), утечку
// system prompt / system instructions, подозрительные URL (включая IP-обфускацию)
// и shell-команды (включая download-cradle и encoded exec).
// critical → ответ блокируется; high/medium → фрагмент редактируется.
// Наружу — только безопасные маркеры, без сырых значений.

import {
  decodeLayers,
  normalizeText,
  scanSecrets,
  type SecretFinding,
  type SecretKind,
} from './secrets.js';

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
  'base32_secret',
  'split_secret',
  'hex_secret',
]);

const URL_RE = /\b(?:https?|ftp|file|javascript|data):[^\s<>"'`)\]]+/gi;
// IPv6-литерал содержит ']', который URL_RE исключает как markdown-скобку.
// Отдельный матч для [::ffff:…] (RT-91, round-4).
const IPV6_URL_RE = /\b(?:https?|ftp):\/\/\[[^\]\s]+\][^\s<>"'`)]*/gi;
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

// Wildcard-DNS, через который SSRF обходит IP-literal проверки (RT-90, round-4):
// 169.254.169.254.nip.io резолвится в metadata-IP, но хост — домен.
const WILDCARD_DNS_RE = /\.(?:nip\.io|sslip\.io|xip\.io|localtest\.me|lvh\.me)$/i;
// Облачные metadata-хосты, которые не являются IP-literal.
const METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata.goog', 'metadata.azure.internal']);

const COMMAND_PATTERNS: ReadonlyArray<RegExp> = [
  // Trailing \b после несловесных символов (/, ~, *) никогда не матчится —
  // голое «rm -rf /» проходило насквозь (RT-36, round-2 red team).
  // Lookahead требует ОБА флага r и f в любом порядке (-fr, -Rf, -r -f) и
  // цель — корень/~/*/HOME, а не любой абсолютный путь: rm -f /tmp/x не
  // является destructive-root (RT-92, round-4).
  /\brm\s+(?=[^\n]{0,40}-[a-z]*r)(?=[^\n]{0,40}-[a-z]*f)[^\n]{0,40}(?:(?<![\w/.-])\/\*?|(?<![\w/.-])\/\{[^}\n]{0,80}\}|~\/?\*?|(?<![\w/.-])\*|["']?\$\{?HOME\}?["']?\/?\*?["']?|(?:\/[^\s/]+\/)+\.\.\/\*)(?=[\s;&|]|$)/gi,
  // Длинные флаги: rm --recursive --force / (порядок любой).
  /\brm\s+(?=[^\n]{0,60}--recursive)(?=[^\n]{0,60}--force)[^\n]{0,60}(?:(?<![\w/.-])\/\*?|(?<![\w/.-])\/\{[^}\n]{0,80}\}|~\/?\*?|(?<![\w/.-])\*|["']?\$\{?HOME\}?["']?\/?\*?["']?|(?:\/[^\s/]+\/)+\.\.\/\*)(?=[\s;&|]|$)/gi,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/g,
  /\b(?:curl|wget)\b[^\n|]{0,200}\|\s*(?:sudo\s+)?(?:ba)?sh\b/gi,
  // Process substitution / command substitution: bash <(curl …),
  // sh -c "$(wget …)" (RT-94, round-4).
  /\b(?:ba|z|da)?sh\s+<\(\s*(?:curl|wget)\b/gi,
  /\b(?:ba|z|da)?sh\s+-[a-z]*c[a-z]*\s+["']?\$\(\s*(?:curl|wget)\b/gi,
  /\b(?:source|\.)\s+<\(\s*(?:curl|wget)\b/gi,
  /\beval\s+["']?\$\(\s*(?:curl|wget)\b/gi,
  /\bbase64\s+(?:-d|--decode)\b[^\n|]{0,120}\|\s*(?:ba)?sh\b/gi,
  /\bpowershell(?:\.exe)?\b[^\n]{0,120}-(?:enc|encodedcommand)\b/gi,
  /\bchild_process\b/g,
  /\bos\.system\s*\(/g,
  /\bsubprocess\.[A-Za-z]+\([^\n)]*shell\s*=\s*True/g,
  /\bnc\s+-e\s+\/(?:bin\/)?(?:ba)?sh\b/gi,
  // Флаги перед/после режима, включая -R -v и --recursive (RT-93, round-4).
  /\bchmod\s+(?:--?[a-z-]+\s+)*777\s+\//gi,
  /\bchmod\s+777\s+(?:--?[a-z-]+\s+)*\//gi,
  // PowerShell download-cradle: IEX (New-Object Net.WebClient).DownloadString(…)
  // (RT-71, round-3 red team).
  /\b(?:iex|invoke-expression)\b[^\n]{0,120}\b(?:downloadstring|downloadfile|invoke-webrequest|invoke-restmethod|iwr)\b/gi,
  /\bnew-object\s+\S*webclient\b[^\n]{0,120}\bdownload/gi,
  // LOLBin-загрузка: certutil -urlcache -split -f https://… (RT-72, round-3).
  /\bcertutil\b[^\n]{0,120}-urlcache/gi,
  // Encoded exec в коде: eval(atob('…')), Function(atob('…')),
  // exec(base64.b64decode(…)) — payload не обязан содержать секрет
  // (RT-73, round-3).
  /\b(?:eval|Function|setTimeout|setInterval)\s*\(\s*atob\s*\(/g,
  /\bexec\s*\(\s*(?:compile\s*\(\s*)?base64\.b64decode/g,
];

const LEAK_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:here(?:'s| is)|reveal(?:ing)?|print(?:ing)?|display(?:ing)?|show(?:ing)?|leak(?:ing)?)\s+(?:my|the)\s+system\s+(?:prompt|message)\b/gi,
  /\bmy\s+system\s+(?:prompt|message)\s+(?:is|was|says)\b/gi,
  // «system instructions» — тот же смысл другим словом (RT-69, round-3).
  // Раскрытие = двоеточие/тире или предписывающий глагол: легитимное
  // «the system instructions are documented in the repo» не бьём (FP-тест).
  /\b(?:my|our|the)\s+system\s+instructions?\s+(?:are|is|was)\s*[:—-]\s*\S+/gi,
  /\b(?:my|our)\s+system\s+instructions?\s+(?:require[sd]?|forbid[sd]?)\b/gi,
  /\b(?:here(?:'s| is)|these)\s+(?:are\s+)?(?:my|our|the)\s+system\s+instructions?\b/gi,
  // \w в JS не покрывает кириллицу: «системный» ломал паттерн до [а-яё] (RT-51, round-2).
  /(?:вот|показываю|вывожу|раскрываю)\s+(?:мой\s+|мои\s+)?системн[а-яё]*\s+(?:промпт[а-яё]*|инструкц[а-яё]*)/gi,
  /системн[а-яё]*\s+(?:промпт[а-яё]*|инструкц[а-яё]*)\s*[:—-]\s*\S+/gi,
];

function normalizeForLeak(s: string): string {
  // NFKC + все Default_Ignorable (zero-width/BOM/soft hyphen/tags): fullwidth
  // и невидимые вставки не должны обходить сравнение с system prompt.
  return normalizeText(s).toLowerCase();
}

/** Потолок находок на ответ: защита от O(n²) на гигантском completion. */
const MAX_OUTPUT_FINDINGS = 100;

function secretToOutput(f: SecretFinding): OutputFinding {
  // Wrapper-находки (base64/base32/split/hex) несут severity внутреннего
  // секрета: split e-mail/телефона — medium (redact), split API-key — critical.
  const wrapper = f.kind === 'base64_secret' || f.kind === 'base32_secret' || f.kind === 'split_secret' || f.kind === 'hex_secret';
  const critical = wrapper ? f.severity !== 'medium' : SENSITIVE_SECRETS.has(f.kind);
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
  const normalizedPrompt = systemPrompt ? normalizeForLeak(systemPrompt) : '';
  if (normalizedPrompt.length >= 24) {
    const needle = normalizedPrompt;
    const needleHead = needle.slice(0, 200);
    // base64/base32-декоды ответа, включая варианты с пробелами/переносами:
    // перед декодом убираем whitespace, чтобы MIME-wrap не обходил проверку.
    const compact = response.replace(/\s+/g, '');
    const decoded = [...decodeLayers(response), ...decodeLayers(compact)].map(normalizeForLeak);
    const containsNeedle = (text: string): boolean =>
      text.includes(needle) || (needleHead.length >= 40 && text.includes(needleHead));
    if (containsNeedle(hay) || decoded.some(containsNeedle)) {
      return {
        kind: 'system_prompt_leak',
        label: 'verbatim system prompt',
        severity: 'critical',
        preview: '[SYSTEM PROMPT VERBATIM]',
        index: Math.max(0, hay.indexOf(needle.slice(0, Math.min(20, needle.length)))),
        length: 0,
        redaction: '[BLOCKED_SYSTEM_PROMPT_LEAK]',
      };
    }
  }
  // Disclosure-фразы проверяем на нормализованном виде: zero-width/fullwidth
  // не должны обходить «here is my system prompt» (audit follow-up).
  for (const re of LEAK_PATTERNS) {
    re.lastIndex = 0;
    const m = re.exec(hay);
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
  const prefixScheme = /^([a-z][a-z0-9+.-]*):/i.exec(raw)?.[1]?.toLowerCase();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Bracketed authority ламает new URL (URL_RE режет ']'), но опасная
    // схема остаётся опасной: javascript://[::1], file://[...] (audit follow-up).
    if (prefixScheme === 'javascript' || prefixScheme === 'data' || prefixScheme === 'file') {
      return {
        kind: 'suspicious_url',
        label: 'high-risk URL',
        severity: 'high',
        preview: `${prefixScheme}://…`,
        index: 0,
        length: raw.length,
        redaction: '[SUSPICIOUS_URL]',
      };
    }
    return null;
  }
  const scheme = url.protocol.toLowerCase();
  // Трейлинг-точка FQDN: metadata.google.internal. должен нормализоваться.
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  // IP-обфускация: десятичное целое (2130706433 = 127.0.0.1) и hex-формы
  // (0x7f.0x0.0x0.0x1) — new URL их не нормализует, старый dotted-quad-тест
  // проходил мимо (RT-74/RT-75, round-3 red team).
  const ipObfuscated =
    /^\d{1,10}$/.test(host) ||
    /^0x[0-9a-f]{1,8}$/i.test(host) ||
    /^(?:0x[0-9a-f]{1,2}\.){3}0x[0-9a-f]{1,2}$/i.test(host);
  // IPv6: mapped IPv4, NAT64, IPv4-compatible, loopback/link-local/ULA.
  // Строка hostname сохраняет скобки.
  const hostNoBrackets = host.replace(/^\[|\]$/g, '');
  const ipv6Mapped =
    /^::ffff:/i.test(hostNoBrackets) ||
    /^64:ff9b:/i.test(hostNoBrackets) ||
    /^2002:/i.test(hostNoBrackets) ||
    /^::(?:ffff:)?(?:169\.254\.169\.254|a9fe:a9fe)$/i.test(hostNoBrackets);
  const ipv6Local =
    hostNoBrackets === '::1' ||
    /^fe80:/i.test(hostNoBrackets) ||
    /^f[cd][0-9a-f]{2}:/i.test(hostNoBrackets);
  const wildcardDns = WILDCARD_DNS_RE.test(host) || host.endsWith('.localhost');
  const metadataHost = METADATA_HOSTS.has(hostNoBrackets);
  const highRisk =
    scheme === 'javascript:' ||
    scheme === 'data:' ||
    scheme === 'file:' ||
    host === '169.254.169.254' ||
    host.startsWith('xn--') ||
    ipObfuscated ||
    ipv6Mapped ||
    ipv6Local ||
    wildcardDns ||
    metadataHost ||
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
  const high: OutputFinding[] = [];
  const medium: OutputFinding[] = [];
  const seen = new Set<number>();
  for (const re of [URL_RE, IPV6_URL_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const index = m.index;
      const raw = m[0];
      if (seen.has(index)) continue;
      const f = classifyUrl(raw);
      // seen только для принятых находок: частичный URL_RE-матч IPv6
      // (без ']') не должен скрывать полный IPV6_URL_RE-матч.
      if (!f) continue;
      seen.add(index);
      // High-risk не режем никогда: medium-поток не должен вытеснить
      // critical/high находку из решения (audit F1).
      if (f.severity === 'high') high.push({ ...f, index });
      else if (medium.length < MAX_OUTPUT_FINDINGS) medium.push({ ...f, index });
    }
  }
  // WHATWG URL strip-ит tab/newline в схеме: java\nscript: — это javascript:.
  // URL_RE такую схему не собирает (audit F7).
  for (const m of text.matchAll(/java[\t\r\n ]{0,3}script\s*:/gi)) {
    const index = m.index;
    if (seen.has(index)) continue;
    seen.add(index);
    high.push({
      kind: 'suspicious_url',
      label: 'obfuscated javascript URL',
      severity: 'high',
      preview: 'javascript:…',
      index,
      length: m[0].length,
      redaction: '[SUSPICIOUS_URL]',
    });
  }
  return [...high, ...medium];
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
  // Один проход вместо O(findings × length): на большом completion с тысячами
  // URL/команд repeated slicing блокировал event loop (audit P1).
  const applicable = findings
    .filter((f) => f.length > 0 && f.kind !== 'system_prompt_leak')
    .sort((a, b) => a.index - b.index);
  if (applicable.length === 0) return text;
  const parts: string[] = [];
  let cursor = 0;
  for (const f of applicable) {
    if (f.index < cursor) continue;
    parts.push(text.slice(cursor, f.index), f.redaction);
    cursor = f.index + f.length;
  }
  parts.push(text.slice(cursor));
  return parts.join('');
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
  // Потолок — только для medium: critical/high нельзя выбрасывать до решения
  // (100 e-mail не должны прятать API-key/команду; audit F1). Redaction и так
  // one-pass, поэтому medium-поток не создаёт O(n²).
  const critical = findings.filter((f) => f.severity !== 'medium' || f.kind === 'system_prompt_leak');
  const medium = findings.filter((f) => f.severity === 'medium' && f.kind !== 'system_prompt_leak');
  const capped = [...critical, ...medium.slice(0, MAX_OUTPUT_FINDINGS)];

  const blocked = capped.some((f) => f.severity === 'critical' || f.kind === 'system_prompt_leak');
  if (blocked) {
    const warning = warningFor(capped, 'blocked');
    return {
      action: 'blocked',
      findings: capped,
      text: warning ?? '[BLOCKED_BY_OUTPUT_GUARD]',
      warning,
    };
  }

  if (capped.length > 0) {
    const warning = warningFor(capped, 'redacted');
    return { action: 'redacted', findings: capped, text: applyRedactions(response, capped), warning };
  }

  return { action: 'allow', findings: capped, text: response, warning: null };
}

/** Безопасная сводка для audit-лога. */
export function summarizeOutputFindings(findings: readonly OutputFinding[]): Array<{
  kind: OutputFindingKind;
  severity: OutputFinding['severity'];
  preview: string;
}> {
  return findings.map(({ kind, severity, preview }) => ({ kind, severity, preview }));
}
