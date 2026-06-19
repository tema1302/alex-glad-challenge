// Слой персистентности через node:sqlite (встроен в Node 24, без нативных сборок).
// Хранит новости, посты и образцы стиля для канала "Иди на факты глянь".

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export interface NewsRow {
  id: number;
  url: string;
  title: string;
  summary: string;
  published_at: string;        // ISO
  source: string;
  used: number;                // 0/1
  created_at: string;
}

export interface PostRow {
  id: number;
  news_id: number | null;
  content: string;
  verdict: string | null;      // результат фактчекинга
  created_at: string;
}

export interface StyleSampleRow {
  id: number;
  text: string;
  created_at: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  published_at TEXT NOT NULL,
  source TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  news_id INTEGER,
  content TEXT NOT NULL,
  verdict TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (news_id) REFERENCES news(id)
);

CREATE TABLE IF NOT EXISTS style_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_news_published ON news(published_at);
CREATE INDEX IF NOT EXISTS idx_news_used ON news(used);
`;

export class BlogDb {
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

  // --- news ---
  insertNews(row: Omit<NewsRow, 'id' | 'used' | 'created_at'>): boolean {
    try {
      this.db
        .prepare(
          'INSERT INTO news (url, title, summary, published_at, source) VALUES (?, ?, ?, ?, ?)',
        )
        .run(row.url, row.title, row.summary, row.published_at, row.source);
      return true;
    } catch {
      return false; // UNIQUE conflict — уже в базе
    }
  }

  unusedNewsSince(iso: string): NewsRow[] {
    return this.db
      .prepare(
        'SELECT * FROM news WHERE used = 0 AND published_at >= ? ORDER BY published_at DESC',
      )
      .all(iso) as unknown as NewsRow[];
  }

  markUsed(id: number): void {
    this.db.prepare('UPDATE news SET used = 1 WHERE id = ?').run(id);
  }

  // --- posts ---
  insertPost(content: string, newsId: number | null, verdict: string | null = null): number {
    const stmt = this.db.prepare(
      'INSERT INTO posts (news_id, content, verdict) VALUES (?, ?, ?)',
    );
    const result = stmt.run(newsId, content, verdict);
    return Number(result.lastInsertRowid);
  }

  recentPosts(limit = 10): PostRow[] {
    return this.db
      .prepare('SELECT * FROM posts ORDER BY created_at DESC LIMIT ?')
      .all(limit) as unknown as PostRow[];
  }

  getPost(id: number): PostRow | null {
    const row = this.db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
    return (row ?? null) as PostRow | null;
  }

  updatePostContent(id: number, content: string): void {
    this.db.prepare('UPDATE posts SET content = ? WHERE id = ?').run(content, id);
  }

  deletePost(id: number): boolean {
    const result = this.db.prepare('DELETE FROM posts WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // --- style_samples ---
  addStyleSample(text: string): boolean {
    try {
      this.db.prepare('INSERT INTO style_samples (text) VALUES (?)').run(text);
      return true;
    } catch {
      return false;
    }
  }

  styleSamples(limit = 10): StyleSampleRow[] {
    return this.db
      .prepare('SELECT * FROM style_samples ORDER BY RANDOM() LIMIT ?')
      .all(limit) as unknown as StyleSampleRow[];
  }

  styleSamplesCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM style_samples').get() as { n: number };
    return row.n;
  }

  newsCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM news').get() as { n: number };
    return row.n;
  }

  postsCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM posts').get() as { n: number };
    return row.n;
  }
}
