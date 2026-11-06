// Security review: строгий JSON-контракт, severity policy и безопасный feedback.
//
// Fail-closed: невалидный JSON/отсутствие findings не считаются «чисто» —
// loop обязан остановиться без коммита. Все тексты находок проходят
// maskSecrets, чтобы даже неудачный ответ модели не утёк в лог.

import { maskSecrets, scanSecrets } from '../gateway/secrets.js';
import type {
  GatewayFinding,
  SecurityDecision,
  SecurityFinding,
  SecurityReview,
  SecuritySeverity,
} from './types.js';

export type ParseResult =
  | { readonly ok: true; readonly review: SecurityReview }
  | { readonly ok: false; readonly error: string };

const CATEGORIES: ReadonlySet<string> = new Set([
  'hardcoded_secret',
  'insecure_storage',
  'insecure_network',
  'pii_in_logs',
  'missing_input_validation',
  'missing_pinning',
  'missing_root_detection',
  'exported_component',
  'authz',
  'other',
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

function safeText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return maskSecrets(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeSeverity(value: unknown): SecuritySeverity {
  const raw = String(value ?? '')
    .toLowerCase()
    .trim();
  if (raw.includes('crit')) return 'critical';
  if (raw.includes('high')) return 'high';
  if (raw.includes('med')) return 'medium';
  if (raw.includes('low')) return 'low';
  // Неизвестная severity — не повод пропустить находку: fail-closed.
  return 'high';
}

function normalizeLine(value: unknown): number | null {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

function normalizeCategory(value: unknown): string {
  const raw = String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_');
  return CATEGORIES.has(raw) ? raw : 'other';
}

function normalizeFinding(value: unknown): SecurityFinding | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const title = safeText(rec.title ?? rec.issue ?? rec.message, 200);
  if (!title) return null;
  return {
    severity: normalizeSeverity(rec.severity),
    category: normalizeCategory(rec.category),
    line: normalizeLine(rec.line),
    title,
    evidence: safeText(rec.evidence ?? rec.snippet, 240),
    recommendation: safeText(rec.recommendation ?? rec.fix, 300),
  };
}

function extractJson(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = fenced?.[1] ?? raw;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

/** Парсит ответ security review. Любая неопределённость — ok:false (fail-closed). */
export function parseSecurityReview(raw: string): ParseResult {
  const json = extractJson(raw);
  if (!json) return { ok: false, error: 'security review: JSON object not found' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'security review: invalid JSON' };
  }

  const root = asRecord(parsed);
  if (!root) return { ok: false, error: 'security review: JSON root is not an object' };

  const rawFindings = root.findings ?? root.issues;
  if (!Array.isArray(rawFindings)) {
    return { ok: false, error: 'security review: findings must be an array' };
  }
  if (rawFindings.length > 50) {
    return { ok: false, error: 'security review: too many findings' };
  }

  const findings: SecurityFinding[] = [];
  for (const item of rawFindings) {
    const finding = normalizeFinding(item);
    // Не теряем находку молча: malformed finding — fail-closed.
    if (!finding) return { ok: false, error: 'security review: malformed finding' };
    findings.push(finding);
  }

  return {
    ok: true,
    review: {
      summary: safeText(root.summary, 300),
      findings,
    },
  };
}

/** critical/high блокируют коммит; medium/low — warning. */
export function classifySecurityReview(review: SecurityReview): SecurityDecision {
  const blocking = review.findings.filter(
    (f) => f.severity === 'critical' || f.severity === 'high',
  );
  const warnings = review.findings.filter(
    (f) => f.severity === 'medium' || f.severity === 'low',
  );
  const action: SecurityDecision['action'] =
    blocking.length > 0 ? 'regenerate' : warnings.length > 0 ? 'commit_with_warning' : 'commit';
  return { action, blocking, warnings };
}

/** Фидбек в generation: «исправь: … в строке N» + рекомендация. */
export function formatSecurityFeedback(findings: readonly SecurityFinding[]): string {
  if (findings.length === 0) {
    return 'Security review не дал пригодного результата. Верни безопасную версию кода.';
  }
  const lines = findings.slice(0, 12).map((f) => {
    const where = f.line === null ? 'строка не определена' : `строка ${f.line}`;
    const fix = f.recommendation ? ` Исправление: ${f.recommendation}` : '';
    return `- [${f.severity.toUpperCase()}] ${where}: ${f.title}.${fix}`;
  });
  return [
    'Исправь проблемы безопасности и верни полный код заново:',
    ...lines,
    'Не добавляй реальные секреты/PII; используй secure storage, env/BuildConfig и redaction в логах.',
  ].join('\n');
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

function isSecretKind(kind: string): boolean {
  return (
    kind === 'api_key' ||
    kind === 'github_token' ||
    kind === 'aws_key' ||
    kind === 'google_key' ||
    kind === 'slack_token' ||
    kind === 'jwt' ||
    kind === 'bearer' ||
    kind === 'private_key' ||
    kind === 'base64_secret' ||
    kind === 'split_secret' ||
    kind === 'hex_secret'
  );
}

/**
 * Gateway заблокировал security review, потому что в сгенерированном коде
 * оказался секрет/PII. Локально находим строку тем же детектором и отдаём
 * loop-у обычный security feedback. Сырые значения не логируем.
 */
export function gatewayFindingsToSecurity(
  code: string,
  findings: readonly GatewayFinding[],
): SecurityFinding[] {
  const local = scanSecrets(code);
  const out: SecurityFinding[] = [];
  const seen = new Set<string>();

  for (const finding of findings.slice(0, 20)) {
    const match = local.find((f) => f.kind === finding.kind);
    const line = match ? lineAt(code, match.index) : null;
    const key = `${finding.kind}:${line ?? '?'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      severity: finding.severity === 'critical' ? 'critical' : 'high',
      category: isSecretKind(finding.kind) ? 'hardcoded_secret' : 'other',
      line,
      title: `gateway input guard: ${finding.kind}`,
      evidence: `gateway finding ${finding.kind} (${finding.preview})`,
      recommendation:
        'Убери секрет/PII из кода: загружай из secure storage/env/BuildConfig, не логируй и не возвращай клиенту.',
    });
  }

  if (out.length === 0) {
    out.push({
      severity: 'high',
      category: 'other',
      line: null,
      title: 'gateway input guard заблокировал security review',
      evidence: 'review prompt не дошёл до LLM',
      recommendation:
        'Убери секреты/PII из сгенерированного кода и повтори генерацию; не ослабляй gateway guard.',
    });
  }
  return out;
}
