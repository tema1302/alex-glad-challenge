// CRM-слой support-assistant (день 33): пользователи и тикеты продукта CloudNote.
// Таблицы живут в общем blog.sqlite (dataPath('blog.sqlite')) — решение пользователя.
// Отдельный класс (не расширение BlogDb): domain-separation + surgical — db.ts не
// трогается. node:sqlite, WAL, parameterized `?` (инвариант CLAUDE.md — никакой
// строковой интерполяции в SQL). CREATE TABLE IF NOT EXISTS — идемпотентно, не
// ломает существующие таблицы (news/posts/style_samples). Несколько DatabaseSync
// на одном файле (BlogDb + CrmDb + crm-server child) под WAL безопасны; close() в
// finally обязателен.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export interface UserRow {
  id: number;
  name: string;
  email: string;
  plan: string;        // 'Free' | 'Pro' | 'Team'
  locale: string;      // 'ru' | 'en'
  two_fa: number;      // 0/1
  created_at: string;
}

export interface TicketRow {
  id: number;
  user_id: number;
  subject: string;
  status: string;      // 'open' | 'pending' | 'closed'
  priority: string;    // 'low' | 'normal' | 'high'
  details: string;     // JSON-строка: { browser?, invoice_id?, error?, webhook?, ... }
  created_at: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'Free',
  locale TEXT NOT NULL DEFAULT 'ru',
  two_fa INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'normal',
  details TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
`;

export interface UserInput {
  id: number;
  name: string;
  email: string;
  plan: string;
  locale: string;
  twoFa: number;
}

export interface TicketInput {
  id: number;
  userId: number;
  subject: string;
  status: string;
  priority: string;
  details: string; // уже JSON-строка; валидация на стороне подготовки данных
}

export class CrmDb {
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

  getUser(id: number): UserRow | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    return (row ?? null) as UserRow | null;
  }

  getTicket(id: number): TicketRow | null {
    const row = this.db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    return (row ?? null) as TicketRow | null;
  }

  listUserTickets(userId: number): TicketRow[] {
    return this.db
      .prepare('SELECT * FROM tickets WHERE user_id = ? ORDER BY created_at DESC')
      .all(userId) as unknown as TicketRow[];
  }

  usersCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
    return row.n;
  }

  ticketsCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM tickets').get() as { n: number };
    return row.n;
  }

  // INSERT OR REPLACE с явным id — идемпотентный seed: повторный прогон
  // support-seed перезаписывает те же строки, не плодит дубликаты и сохраняет
  // предсказуемые id (#1..5 для smoke-кейсов). created_at на REPLACE обновляется.
  upsertUser(row: UserInput): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO users (id, name, email, plan, locale, two_fa) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(row.id, row.name, row.email, row.plan, row.locale, row.twoFa);
  }

  upsertTicket(row: TicketInput): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO tickets (id, user_id, subject, status, priority, details) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(row.id, row.userId, row.subject, row.status, row.priority, row.details);
  }
}
