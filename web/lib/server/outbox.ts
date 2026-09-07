// Outbox — веб-собственная история публикаций в TG (ТЗ §7.2). Без изменений
// challenge/core: singleton над challenge/.data/web-outbox.sqlite, запись только
// через withDb() (serial-очередь web/lib/server/db.ts). Пишется в каждом
// publish-пути (manual/blog/summary) из web/lib/server/tg-publish.ts.
import 'server-only';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { dataPath } from './challenge';

export type OutboxSource = 'manual' | 'blog' | 'summary';

export interface OutboxRow {
  id: number;
  text: string;
  source: OutboxSource;
  blog_post_id: number | null;
  message_id: number | null;
  status: 'ok' | 'error';
  error: string | null;
  created_at: string;
}

export interface OutboxInsert {
  text: string;
  source: OutboxSource;
  blogPostId?: number | null;
  messageId?: number | null;
  status: 'ok' | 'error';
  error?: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tg_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual','blog','summary')),
  blog_post_id INTEGER,
  message_id INTEGER,
  status TEXT NOT NULL CHECK (status IN ('ok','error')),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_outbox_created ON tg_outbox(created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_post ON tg_outbox(blog_post_id);
`;

class OutboxDb {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  insert(row: OutboxInsert): number {
    const result = this.db
      .prepare(
        'INSERT INTO tg_outbox (text, source, blog_post_id, message_id, status, error) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(row.text, row.source, row.blogPostId ?? null, row.messageId ?? null, row.status, row.error ?? null);
    return Number(result.lastInsertRowid);
  }

  recent(limit = 20): OutboxRow[] {
    return this.db
      .prepare('SELECT * FROM tg_outbox ORDER BY id DESC LIMIT ?')
      .all(limit) as unknown as OutboxRow[];
  }

  // Последняя запись по посту (ok ИЛИ error) — для Badge-статуса на странице блога.
  latestForPost(blogPostId: number): OutboxRow | null {
    const row = this.db
      .prepare('SELECT * FROM tg_outbox WHERE blog_post_id = ? ORDER BY id DESC LIMIT 1')
      .get(blogPostId);
    return (row as unknown as OutboxRow) ?? null;
  }
}

let instance: OutboxDb | null = null;

export function getOutboxDb(): OutboxDb {
  if (!instance) instance = new OutboxDb(dataPath('web-outbox.sqlite'));
  return instance;
}
