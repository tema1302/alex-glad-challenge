// Input Guard (ADVANCED day-13): проверка входящего промпта до отправки в LLM.
//
// block — находка любого секрета блокирует запрос (LLM не вызывается);
// mask  — секреты заменяются маркерами, запрос проходит дальше.
// Warning никогда не содержит сырое значение секрета.

import type { ChatMessage } from '../types.js';
import {
  maskMessages,
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
  /** Сообщения для upstream: исходные (allow) или замаскированные (masked). */
  readonly messages: readonly ChatMessage[];
  readonly warning: string | null;
}

export const DEFAULT_GUARD_MODE: GuardMode = 'block';

export function guardInput(
  messages: readonly ChatMessage[],
  opts: InputGuardOptions = {},
): InputGuardResult {
  const mode = opts.mode ?? DEFAULT_GUARD_MODE;
  const findings = scanMessages(messages);
  const summary = summarizeFindings(findings);

  if (findings.length === 0) {
    return { action: 'allow', findings, summary, messages, warning: null };
  }

  const kinds = [...new Set(findings.map((f) => f.kind))].join(', ');
  if (mode === 'mask') {
    return {
      action: 'masked',
      findings,
      summary,
      messages: maskMessages(messages),
      warning: `Input Guard: замаскированы секреты (${kinds}). В LLM ушли безопасные маркеры.`,
    };
  }

  return {
    action: 'blocked',
    findings,
    summary,
    messages,
    warning:
      `Input Guard: запрос заблокирован, секреты (${kinds}) не отправлены в LLM. ` +
      'Уберите чувствительные данные или включите режим mask.',
  };
}
