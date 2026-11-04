// Audit-лог gateway: каждый запрос/ответ пишется в JSONL.
//
// Инвариант: в лог попадают только замаскированные preview (maskSecrets
// применяется ещё раз на границе логирования), kind/severity находок и
// usage/cost. Сырые секреты и полные тела не сохраняются.

import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { dataPath } from '../paths.js';
import type { Usage } from '../types.js';
import { maskSecrets } from './secrets.js';

export type AuditStatus =
  | 'allowed'
  | 'masked'
  | 'blocked_input'
  | 'blocked_output'
  | 'rate_limited'
  | 'upstream_error'
  | 'bad_request';

export interface AuditFinding {
  readonly kind: string;
  readonly severity: string;
  readonly preview: string;
  readonly via?: string;
}

export interface AuditRecord {
  readonly ts: string;
  readonly requestId: string;
  readonly ip: string;
  readonly provider: string;
  readonly model: string;
  readonly status: AuditStatus;
  readonly latencyMs: number;
  readonly inputFindings: readonly AuditFinding[];
  readonly outputFindings: readonly AuditFinding[];
  readonly promptPreview: string;
  readonly responsePreview: string;
  readonly usage?: Usage;
  readonly costUsd?: number;
  readonly warning?: string;
}

export interface InterceptedRecord {
  readonly ts: string;
  readonly requestId: string;
  readonly direction: 'input' | 'output';
  readonly kind: string;
  readonly severity: string;
  readonly preview: string;
  readonly via?: string;
}

export interface AuditSink {
  write(record: AuditRecord): void;
}

export interface InterceptedSink {
  write(record: InterceptedRecord): void;
}

export class MemoryAuditLog implements AuditSink {
  readonly records: AuditRecord[] = [];
  write(record: AuditRecord): void {
    this.records.push(record);
  }
}

export class MemoryInterceptedLog implements InterceptedSink {
  readonly records: InterceptedRecord[] = [];
  write(record: InterceptedRecord): void {
    this.records.push(record);
  }
}

function appendJsonl(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  appendFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

export class JsonlAuditLog implements AuditSink {
  private readonly filePath: string;
  constructor(filePath: string = dataPath('gateway', 'audit.jsonl')) {
    this.filePath = filePath;
  }
  write(record: AuditRecord): void {
    appendJsonl(this.filePath, record);
  }
}

export class JsonlInterceptedLog implements InterceptedSink {
  private readonly filePath: string;
  constructor(filePath: string = dataPath('gateway', 'intercepted.jsonl')) {
    this.filePath = filePath;
  }
  write(record: InterceptedRecord): void {
    appendJsonl(this.filePath, record);
  }
}

/** Безопасный preview: маскирует секреты, схлопывает пробелы, обрезает. */
export function safePreview(text: string, max = 400): string {
  const masked = maskSecrets(text).replace(/\s+/g, ' ').trim();
  return masked.length > max ? `${masked.slice(0, max)}…` : masked;
}
