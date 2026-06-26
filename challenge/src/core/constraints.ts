// Инварианты и ограничения (день 14).
// Хранятся отдельно от диалога, памяти и профиля.
// Инжектируются в каждый промпт как жёсткий системный блок.
// LLM инструктирован отказывать, если запрос нарушает инвариант.
//
// Типы инвариантов:
//   architecture — выбранная архитектура
//   tech_decision — принятые технические решения
//   stack — ограничения по стеку
//   business — бизнес-правила
//   custom — произвольные

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ChatMessage } from './types.js';
import { msg } from './types.js';

export type ConstraintType = 'architecture' | 'tech_decision' | 'stack' | 'business' | 'custom';

export interface Constraint {
  id: string;
  type: ConstraintType;
  title: string;
  description: string;
  createdAt: string;
}

const VALID_TYPES: ConstraintType[] = ['architecture', 'tech_decision', 'stack', 'business', 'custom'];

export class Constraints {
  private items: Constraint[] = [];
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.ensureDir();
  }

  get all(): Constraint[] {
    return [...this.items];
  }

  get count(): number {
    return this.items.length;
  }

  add(type: ConstraintType, title: string, description: string): Constraint {
    if (!VALID_TYPES.includes(type)) {
      throw new Error(`Неизвестный тип: "${type}". Доступно: ${VALID_TYPES.join(', ')}`);
    }
    const c: Constraint = {
      id: `${type}-${String(this.items.length + 1).padStart(3, '0')}`,
      type,
      title,
      description,
      createdAt: new Date().toISOString(),
    };
    this.items.push(c);
    this.save();
    return c;
  }

  remove(id: string): boolean {
    const idx = this.items.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    this.items.splice(idx, 1);
    this.save();
    return true;
  }

  byType(type: ConstraintType): Constraint[] {
    return this.items.filter((c) => c.type === type);
  }

  save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.items, null, 2), 'utf-8');
  }

  load(): number {
    if (!existsSync(this.filePath)) return 0;
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      this.items = JSON.parse(raw) as Constraint[];
      return this.items.length;
    } catch {
      return 0;
    }
  }

  // Инъекция в промпт: жёсткий блок, который LLM не может нарушать.
  toSystemMessages(): ChatMessage[] {
    if (this.items.length === 0) return [];

    const grouped = new Map<ConstraintType, Constraint[]>();
    for (const c of this.items) {
      if (!grouped.has(c.type)) grouped.set(c.type, []);
      grouped.get(c.type)!.push(c);
    }

    const sections: string[] = [];
    const typeLabels: Record<ConstraintType, string> = {
      architecture: 'Архитектура',
      tech_decision: 'Технические решения',
      stack: 'Ограничения стека',
      business: 'Бизнес-правила',
      custom: 'Прочие ограничения',
    };

    for (const [type, items] of grouped) {
      const lines = items.map((c) => `  • ${c.title}: ${c.description}`);
      sections.push(`${typeLabels[type]}:\n${lines.join('\n')}`);
    }

    return [msg.system(
      `НЕНАРУШИМЫЕ ИНВАРИАНТЫ. Ты НЕ имеешь права предлагать решения, которые нарушают эти правила.\n` +
      `Если запрос пользователя конфликтует с инвариантом — ОТКАЖИСЬ выполнять запрос.\n` +
      `Объясни отказ так: «Я не могу это сделать, потому что действует инвариант: <название>. <причина>».\n` +
      `Предложи альтернативу в рамках инвариантов.\n\n` +
      sections.join('\n\n'),
    )];
  }

  private ensureDir(): void {
    const dir = path.dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}
