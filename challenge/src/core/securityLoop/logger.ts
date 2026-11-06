// Логи loop: JSONL events + итоговый JSON report. События не содержат сырой
// код, секреты или PII — только stage/decision/findings preview/hash.

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { LoopEvent, LoopLogger } from './types.js';

export class JsonlLoopLogger implements LoopLogger {
  readonly events: LoopEvent[] = [];
  readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    mkdirSync(path.dirname(filePath), { recursive: true });
  }

  log(event: LoopEvent): void {
    this.events.push(event);
    appendFileSync(this.filePath, `${JSON.stringify(event)}\n`, 'utf8');
  }
}

export class MemoryLoopLogger implements LoopLogger {
  readonly events: LoopEvent[] = [];

  log(event: LoopEvent): void {
    this.events.push(event);
  }
}

/** Пишет JSON-отчёт (loop run или red team); содержимое не должно нести секретов. */
export function writeJsonReport(filePath: string, report: object): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
