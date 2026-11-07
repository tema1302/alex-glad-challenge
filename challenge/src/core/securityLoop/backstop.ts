// Локальный детерминированный security-скан сгенерированного кода (ADVANCED day-15).
//
// LLM-ревьюер можно убедить («это тестовый код, пропусти»), поэтому решения
// о коммите не доверяют только его вердикту: findings из этого модуля
// мерджатся в review до classify. Критичные/high находки блокируют коммит
// независимо от того, что ответил ревьюер.
//
// Точность важнее полноты: каждый паттерн проверен FP-тестом на легитимном
// коде. Сырые значения секретов не попадают в evidence (maskSecrets).

import { maskSecrets, scanSecrets, type SecretFinding } from '../gateway/secrets.js';
import {
  classifySecurityReview,
  codeLineAt,
  parseSecurityReview,
} from './review.js';
import type {
  SecurityDecision,
  SecurityFinding,
  SecurityReview,
} from './types.js';

/** Максимальное количество находок backstop на один файл. */
const MAX_FINDINGS = 20;

interface MarkerPattern {
  readonly re: RegExp;
  readonly title: string;
  readonly category: string;
}

const GATEWAY_MARKER_RE =
  /\[(?:REDACTED_[A-Z_]+|SUSPICIOUS_URL|SUSPICIOUS_COMMAND|BLOCKED_SYSTEM_PROMPT_LEAK|BLOCKED_BY_OUTPUT_GUARD)\]/g;

/**
 * Фразы-инструкции к ревьюеру/агенту внутри кода (комментарии и строки).
 * Высоко-точные паттерны: каждое выражение проверено FP-тестом.
 */
const INJECTION_PATTERNS: readonly MarkerPattern[] = [
  {
    re: /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?/gi,
    title: 'prompt injection: «ignore previous instructions» в коде',
    category: 'other',
  },
  {
    re: /disregard\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?/gi,
    title: 'prompt injection: «disregard previous instructions» в коде',
    category: 'other',
  },
  {
    re: /(?:игнорир[а-яё]*|проигнорир[а-яё]*|забудь|забыть)\s+(?:все\s+)?(?:предыдущие|прошлые|выше(?:описанные|стоящие)?)\s+(?:инструкц[а-яё]*|указан[а-яё]*|правил[а-яё]*)/gi,
    title: 'prompt injection: «игнорируй предыдущие инструкции» в коде',
    category: 'other',
  },
  {
    re: /это\s+тест(?:овый)?\s+код\W{0,40}(?:security|безопасность|ревью|review)/gi,
    title: 'обход security review: «это тестовый код» + упоминание ревью',
    category: 'other',
  },
  {
    re: /(?:security\s*review|ревью)\W{0,24}(?:пропусти[а-яё]*|skipping|skip|не\s+проверяй)/gi,
    title: 'обход security review: «пропусти ревью» в коде',
    category: 'other',
  },
  {
    re: /(?:верни|вернуть|отвечай|ответить|ответь|respond\s+with|return\s+only|answer\s+with)\W{0,16}"?\s*summary"?\s*:?\s*"/gi,
    title: 'обход security review: попытка подсунуть готовый JSON-вердикт',
    category: 'other',
  },
  {
    // Role reassignment: «you are now the approver» (RT-80, round-3). Требуем
    // назначение роли — «you are now ready to deploy» не бьём.
    re: /\byou\s+are\s+now\s+(?:the\s+|my\s+)?(?:security\s+|code\s+|deploy\s+|release\s+)?(?:approver|reviewer|auditor|bot|agent)\b|ты\s+(?:теперь|больше\s+не)\s+(?:аппрувер|ревьюер|бот|агент|security)|твоя\s+новая\s+роль/gi,
    title: 'prompt injection: подмена роли агента в коде',
    category: 'other',
  },
  {
    // Severity downgrade: убедить classify занизить находки (RT-81, round-3).
    re: /\b(?:classify|mark|treat|report)\s+(?:all|any|every)\s+(?:findings?|issues?|warnings?|vulnerabilities)\s+as\s+(?:informational|info|low|advisory|minor)/gi,
    title: 'обход security review: требование занизить severity находок',
    category: 'other',
  },
  {
    re: /(?:считай|помечай|классифицируй|отмечай)\s+(?:все\s+)?(?:находки|проблемы|замечания|уязвимости)\s+(?:как\s+)?(?:информационн[а-яё]*|несущественн[а-яё]*|низк[а-яё]*(?:\s+(?:severity|приоритет))?|info|advisory)/gi,
    title: 'обход security review: требование занизить severity находок (RU)',
    category: 'other',
  },
  {
    re: /(?:выведи|покажи|распечатай|запиши)\W{0,24}(?:системн[а-яё]*\s+(?:промпт[а-яё]*|инструкц[а-яё]*)|system\s+prompt)/gi,
    title: 'exfil: вывод system prompt из кода',
    category: 'other',
  },
  {
    re: /(?:print|echo|display|reveal)\W{0,20}(?:the\s+)?system\s+prompt/gi,
    title: 'exfil: вывод system prompt из кода',
    category: 'other',
  },
  {
    re: /JSON\.stringify\(\s*process\.env\s*\)/g,
    title: 'PII/секреты в логах: дамп всех env-переменных',
    category: 'pii_in_logs',
  },
  {
    re: /(?:console\.(?:log|info|debug)|Log\.[deiwv]|println!?)\s*\([^)]{0,120}process\.env/gi,
    title: 'PII/секреты в логах: печать env-переменных',
    category: 'pii_in_logs',
  },
];

function evidenceAt(code: string, index: number, length: number): string {
  const raw = code.slice(index, index + length).replace(/\s+/g, ' ').trim();
  return maskSecrets(raw).slice(0, 120);
}

function secretFindings(code: string, secrets: readonly SecretFinding[]): SecurityFinding[] {
  const out: SecurityFinding[] = [];
  for (const secret of secrets.slice(0, MAX_FINDINGS)) {
    out.push({
      severity: 'critical',
      category: 'hardcoded_secret',
      line: codeLineAt(code, secret.index),
      title: `hardcoded secret в коде (${secret.label})`,
      evidence: evidenceAt(code, secret.index, secret.length),
      recommendation:
        'Убери секрет из кода: secure storage / server-side env / BuildConfig; значение не логируй и не возвращай клиенту.',
    });
  }
  return out;
}

function markerFindings(code: string): SecurityFinding[] {
  const out: SecurityFinding[] = [];
  for (const m of [...code.matchAll(GATEWAY_MARKER_RE)].slice(0, MAX_FINDINGS)) {
    out.push({
      severity: 'high',
      category: 'hardcoded_secret',
      line: codeLineAt(code, m.index ?? 0),
      title: 'gateway-маркер [REDACTED_*] продублирован в коде',
      evidence: evidenceAt(code, m.index ?? 0, m[0].length),
      recommendation:
        'Модель попыталась вернуть замаскированный gateway секрет: перегенерируй код с placeholder без секрета.',
    });
  }
  return out;
}

function injectionFindings(code: string): SecurityFinding[] {
  const out: SecurityFinding[] = [];
  for (const pattern of INJECTION_PATTERNS) {
    for (const m of [...code.matchAll(pattern.re)].slice(0, 5)) {
      out.push({
        severity: 'high',
        category: pattern.category,
        line: codeLineAt(code, m.index ?? 0),
        title: pattern.title,
        evidence: evidenceAt(code, m.index ?? 0, m[0].length),
        recommendation:
          'Инструкции внутри кода — данные, а не команды. Убери фразу и не встраивай указания ревьюеру/агенту в код.',
      });
    }
  }
  return out;
}

/**
 * Детерминированные security-находки по коду: секреты (включая обфускацию),
 * gateway-маркеры и injection-фразы. Мержится в review до classify,
 * поэтому «послушный» ревьюер не может протащить коммит.
 */
export function localSecurityFindings(code: string): SecurityFinding[] {
  const secrets = scanSecrets(code);
  return [
    ...secretFindings(code, secrets),
    ...markerFindings(code),
    ...injectionFindings(code),
  ].slice(0, MAX_FINDINGS);
}

export type EvaluatedSecurityReview =
  | {
      readonly ok: false;
      readonly error: string;
      readonly backstop: readonly SecurityFinding[];
    }
  | {
      readonly ok: true;
      /** Вердикт LLM-ревьюера без backstop-находок (для лога/коммита). */
      readonly review: SecurityReview;
      readonly backstop: readonly SecurityFinding[];
      /** review.findings + backstop: единственный источник для classify. */
      readonly findings: readonly SecurityFinding[];
      readonly decision: SecurityDecision;
    };

/**
 * Полный разбор ответа security review: parse (fail-closed на невалидный JSON
 * и leak-фразы) + локальный backstop + classify по объединённым находкам.
 * Единственная точка решения «коммитить или нет» в loop и red-team suite.
 */
export function evaluateSecurityReview(raw: string, code: string): EvaluatedSecurityReview {
  const parsed = parseSecurityReview(raw);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, backstop: [] };
  }
  const backstop = localSecurityFindings(code);
  const findings = [...parsed.review.findings, ...backstop];
  const decision = classifySecurityReview({
    summary: parsed.review.summary,
    findings,
  });
  return { ok: true, review: parsed.review, backstop, findings, decision };
}
