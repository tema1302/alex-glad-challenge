// Слой TODO-задач через node:sqlite. Хранит повторяющиеся напоминания
// и разовые задачи с расписанием для отправки в Telegram.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export interface TodoRow {
  id: number;
  text: string;
  scheduled_at: string | null;
  recurring: 'daily' | 'weekly' | null;
  day_of_week: number | null;
  status: string;
  last_sent: string | null;
  created_at: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  scheduled_at TEXT,
  recurring TEXT,
  day_of_week INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  last_sent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
CREATE INDEX IF NOT EXISTS idx_todos_scheduled ON todos(scheduled_at);
`;

export class TodoDb {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  addTodo(
    text: string,
    scheduledAt?: string | null,
    recurring?: 'daily' | 'weekly' | null,
    dayOfWeek?: number | null,
  ): number {
    const stmt = this.db.prepare(
      'INSERT INTO todos (text, scheduled_at, recurring, day_of_week) VALUES (?, ?, ?, ?)',
    );
    const result = stmt.run(text, scheduledAt ?? null, recurring ?? null, dayOfWeek ?? null);
    return Number(result.lastInsertRowid);
  }

  listTodos(status?: string): TodoRow[] {
    if (status) {
      return this.db
        .prepare('SELECT * FROM todos WHERE status = ? ORDER BY created_at DESC')
        .all(status) as unknown as TodoRow[];
    }
    return this.db
      .prepare('SELECT * FROM todos ORDER BY created_at DESC')
      .all() as unknown as TodoRow[];
  }

  getDueTodos(): TodoRow[] {
    const now = new Date().toISOString();
    const dow = new Date().getDay();

    // Задачи которые пора: pending + (scheduled_at <= now ИЛИ recurring без расписания/по расписанию)
    // Для recurringdaily — отправляем если ещё не отправляли сегодня
    // Для recurring weekly — отправляем если сегодня нужный день недели
    const rows = this.db
      .prepare(
        `SELECT * FROM todos
         WHERE status = 'pending'
           AND (
             (scheduled_at IS NOT NULL AND scheduled_at <= ?)
             OR (recurring = 'daily'
                 AND (last_sent IS NULL OR last_sent < date('now')))
             OR (recurring = 'weekly'
                 AND day_of_week = ?
                 AND (last_sent IS NULL OR last_sent < date('now')))
           )
         ORDER BY created_at ASC`,
      )
      .all(now, dow) as unknown as TodoRow[];

    return rows;
  }

  completeTodo(id: number): boolean {
    const result = this.db
      .prepare("UPDATE todos SET status = 'done' WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  dismissTodo(id: number): boolean {
    const result = this.db
      .prepare("UPDATE todos SET status = 'dismissed' WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  deleteTodo(id: number): boolean {
    const result = this.db.prepare('DELETE FROM todos WHERE id = ?').run(id);
    return result.changes > 0;
  }

  markSent(id: number): void {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE todos SET last_sent = ? WHERE id = ?')
      .run(now, id);
  }

  getPendingSummary(): string {
    const rows = this.listTodos('pending');
    if (rows.length === 0) {
      return 'Нет ожидающих задач.';
    }

    const lines = rows.map((r, i) => {
      const meta: string[] = [];
      if (r.recurring === 'daily') meta.push('ежедневно');
      if (r.recurring === 'weekly') {
        const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
        meta.push(`каждый ${days[r.day_of_week ?? 0]}`);
      }
      if (r.scheduled_at && !r.recurring) {
        meta.push(`на ${r.scheduled_at}`);
      }
      const suffix = meta.length > 0 ? ` [${meta.join(', ')}]` : '';
      return `${i + 1}. ${r.text}${suffix}`;
    });

    return `📋 Ожидающие задачи (${rows.length}):\n${lines.join('\n')}`;
  }
}
