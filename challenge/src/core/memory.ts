// Модель памяти ассистента: три слоя.
//
// Short-term:  последние сообщения текущего диалога (RAM, SlidingWindow).
// Working:     данные текущей задачи — факты, решения, контекст (RAM, Map).
// Long-term:   профиль пользователя, ключевые решения, знания (JSON-файл).
//
// context() собирает все три слоя в массив ChatMessage[]:
//   [long-term system] → [working system] → [short-term messages]
// LLM всегда видит профиль + задачу + недавний диалог.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ChatMessage } from './types.js';
import { msg } from './types.js';

export interface LongTermEntry {
  key: string;
  value: string;
  updatedAt: string;
}

export interface MemorySnapshot {
  shortTermCount: number;
  workingKeys: string[];
  longTermEntries: LongTermEntry[];
}

export class Memory {
  // Short-term: последние N сообщений (включая system).
  private shortTerm: ChatMessage[] = [];
  private readonly shortTermLimit: number;

  // Working: ключ-значение факты текущей задачи.
  private working = new Map<string, string>();
  private taskDescription: string | null = null;

  // Long-term: persistent профиль + знания (JSON).
  private longTerm = new Map<string, string>();
  private readonly filePath: string;

  constructor(opts: { filePath: string; shortTermLimit?: number }) {
    this.filePath = opts.filePath;
    this.shortTermLimit = opts.shortTermLimit ?? 20;
    this.ensureDir();
  }

  // --- Short-term ---

  addMessage(m: ChatMessage): void {
    this.shortTerm.push(m);
  }

  get shortTermMessages(): ChatMessage[] {
    return this.shortTerm.slice(-this.shortTermLimit);
  }

  clearShortTerm(): void {
    this.shortTerm = [];
  }

  // --- Working ---

  setTask(description: string): void {
    this.taskDescription = description;
  }

  get task(): string | null {
    return this.taskDescription;
  }

  setWorkingFact(key: string, value: string): void {
    this.working.set(key, value);
  }

  getWorkingFact(key: string): string | undefined {
    return this.working.get(key);
  }

  removeWorkingFact(key: string): boolean {
    return this.working.delete(key);
  }

  get workingKeys(): string[] {
    return [...this.working.keys()].sort();
  }

  clearWorking(): void {
    this.working.clear();
    this.taskDescription = null;
  }

  // --- Long-term ---

  remember(key: string, value: string): void {
    this.longTerm.set(key, value);
  }

  recall(key: string): string | undefined {
    return this.longTerm.get(key);
  }

  forget(key: string): boolean {
    return this.longTerm.delete(key);
  }

  get longTermKeys(): string[] {
    return [...this.longTerm.keys()].sort();
  }

  saveLongTerm(): void {
    const entries: LongTermEntry[] = [...this.longTerm.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => ({ key, value, updatedAt: new Date().toISOString() }));
    writeFileSync(this.filePath, JSON.stringify(entries, null, 2), 'utf-8');
  }

  loadLongTerm(): number {
    if (!existsSync(this.filePath)) return 0;
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const entries = JSON.parse(raw) as LongTermEntry[];
      this.longTerm.clear();
      for (const e of entries) {
        this.longTerm.set(e.key, e.value);
      }
      return entries.length;
    } catch {
      return 0;
    }
  }

  // --- Сборка контекста для LLM ---

  context(systemPrompt: string): ChatMessage[] {
    const out: ChatMessage[] = [];

    // 1. Базовый system-промпт.
    out.push(msg.system(systemPrompt));

    // 2. Long-term: профиль и знания (инъекция в system).
    if (this.longTerm.size > 0) {
      const lines = [...this.longTerm.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `- ${k}: ${v}`);
      out.push(msg.system(`Долговременная память (профиль пользователя и знания):\n${lines.join('\n')}`));
    }

    // 3. Working: данные текущей задачи (инъекция в system).
    if (this.taskDescription || this.working.size > 0) {
      const parts: string[] = [];
      if (this.taskDescription) {
        parts.push(`Текущая задача: ${this.taskDescription}`);
      }
      if (this.working.size > 0) {
        const facts = [...this.working.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `  - ${k}: ${v}`);
        parts.push(`Контекст задачи:\n${facts.join('\n')}`);
      }
      out.push(msg.system(parts.join('\n\n')));
    }

    // 4. Short-term: последние сообщения диалога.
    out.push(...this.shortTermMessages);

    return out;
  }

  snapshot(): MemorySnapshot {
    return {
      shortTermCount: this.shortTerm.length,
      workingKeys: this.workingKeys,
      longTermEntries: [...this.longTerm.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => ({ key, value, updatedAt: '' })),
    };
  }

  private ensureDir(): void {
    const dir = path.dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}
