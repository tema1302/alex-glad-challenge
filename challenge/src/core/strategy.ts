// Стратегии управления контекстом.
// Полная история, Sliding Window, Sticky Facts, Branching.

import type { ChatMessage } from './types.js';

export interface ContextStats {
  totalMessages: number;
  activeMessages: number;
  messagesDropped: number;
}

export interface ContextStrategy {
  readonly name: string;
  addMessage(msg: ChatMessage): void;
  context(): ChatMessage[];
  stats(): ContextStats;
  clear(): void;
}

// Полная история — простейшая стратегия.
export class FullHistory implements ContextStrategy {
  readonly name = 'full';
  private messages: ChatMessage[] = [];

  addMessage(msg: ChatMessage): void {
    this.messages.push(msg);
  }
  context(): ChatMessage[] {
    return [...this.messages];
  }
  stats(): ContextStats {
    const n = this.messages.length;
    return { totalMessages: n, activeMessages: n, messagesDropped: 0 };
  }
  clear(): void {
    this.messages = [];
  }
}

// Sliding Window: только последние N сообщений.
export class SlidingWindow implements ContextStrategy {
  readonly name = 'sliding';
  private full: ChatMessage[] = [];
  constructor(private readonly windowSize: number) {}

  addMessage(msg: ChatMessage): void {
    this.full.push(msg);
  }
  context(): ChatMessage[] {
    return this.full.slice(-this.windowSize);
  }
  stats(): ContextStats {
    const active = this.context().length;
    return {
      totalMessages: this.full.length,
      activeMessages: active,
      messagesDropped: Math.max(0, this.full.length - active),
    };
  }
  clear(): void {
    this.full = [];
  }
}

// Sticky Facts: ключ-значение факты + последние N сообщений.
export class StickyFacts implements ContextStrategy {
  readonly name = 'sticky';
  private full: ChatMessage[] = [];
  private facts = new Map<string, string>();
  constructor(private readonly windowSize: number) {}

  addMessage(msg: ChatMessage): void {
    this.full.push(msg);
    this.updateFacts(msg);
  }
  context(): ChatMessage[] {
    const out: ChatMessage[] = [];
    if (this.facts.size > 0) {
      const lines = [...this.facts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `- ${k}: ${v}`);
      out.push({
        role: 'system',
        content: `Известные факты о проекте:\n${lines.join('\n')}\n`,
      });
    }
    out.push(...this.full.slice(-this.windowSize));
    return out;
  }
  stats(): ContextStats {
    const active = this.context().length;
    return {
      totalMessages: this.full.length,
      activeMessages: active,
      messagesDropped: Math.max(0, this.full.length - active),
    };
  }
  clear(): void {
    this.full = [];
    this.facts.clear();
  }

  private updateFacts(msg: ChatMessage): void {
    const knownKeys = ['цель', 'бюджет', 'стек', 'deadline', 'дедлайн'];
    for (const line of msg.content.split('\n')) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const k = line.slice(0, idx).trim().toLowerCase();
      const v = line.slice(idx + 1).trim();
      if (knownKeys.includes(k) && v) this.facts.set(k, v);
    }
  }
}

// Branching: чекпойнты и независимые ветки диалога.
export interface BranchInfo {
  id: number;
  label: string;
  parentId: number | null;
  messages: ChatMessage[];
}

export class Branching implements ContextStrategy {
  readonly name = 'branching';
  private branches: BranchInfo[] = [];
  private activeId = 0;
  private allMessages: ChatMessage[] = [];

  constructor() {
    this.branches.push({ id: 0, label: 'main', parentId: null, messages: [] });
  }

  addMessage(msg: ChatMessage): void {
    this.allMessages.push(msg);
    this.branches[this.activeId].messages.push(msg);
  }
  context(): ChatMessage[] {
    return [...this.branches[this.activeId].messages];
  }
  stats(): ContextStats {
    const active = this.branches[this.activeId].messages.length;
    return {
      totalMessages: this.allMessages.length,
      activeMessages: active,
      messagesDropped: Math.max(0, this.allMessages.length - active),
    };
  }
  clear(): void {
    this.branches = [{ id: 0, label: 'main', parentId: null, messages: [] }];
    this.activeId = 0;
    this.allMessages = [];
  }

  checkpoint(label: string): number {
    const snapshot = [...this.branches[this.activeId].messages];
    const id = this.branches.length;
    this.branches.push({ id, label, parentId: this.activeId, messages: snapshot });
    return id;
  }

  switchTo(id: number): void {
    if (id < 0 || id >= this.branches.length) {
      throw new Error(`Нет ветки с id=${id}. Доступно: 0..${this.branches.length - 1}`);
    }
    this.activeId = id;
  }

  get activeBranchId(): number {
    return this.activeId;
  }

  listBranches(): Array<{ id: number; label: string; messageCount: number }> {
    return this.branches.map((b) => ({ id: b.id, label: b.label, messageCount: b.messages.length }));
  }
}
