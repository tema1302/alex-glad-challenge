// FTS5-индекс бота «Фактчемпик»: ОТДЕЛЬНЫЙ файл challenge/.data/tg-fts.sqlite
// (не трогаем tg.sqlite и rag.sqlite). Индексируется только чат «Факты в чате»
// (константа в bot.ts), текстовые сообщения с атрибуцией. Инкремент — по курсору
// max_msg_id в fts_meta; полная пересборка — сборка с нуля в свежий disposable
// .build-файл и подмена им основного (rebuildFtsFull в bot.ts).
// Морфология — префиксом на уровне запроса (buildFtsQuery), не стеммером.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { TgMessageRow } from './tgStore.js';

const SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS fts_msg USING fts5(
  text,
  chat_id UNINDEXED,
  topic_id UNINDEXED,
  from_id UNINDEXED,
  msg_id UNINDEXED,
  date_iso UNINDEXED
);

CREATE TABLE IF NOT EXISTS fts_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export interface FtsHit {
  topicId: number;
  msgId: number;
  fromId: string;
}

export class FtsStore {
  private readonly db: DatabaseSync;
  private readonly insertStmt;
  private readonly path: string;

  constructor(dbPath: string, opts: { disposable?: boolean } = {}) {
    this.path = dbPath;
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    if (opts.disposable) {
      // Сборочный (.build) файл одноразовый: устойчивость не нужна, а WAL-
      // чекпойнты на тяжёлой FTS-вставке — главный тормоз полной сборки
      // (39 с → ~8 с, замер 2026-09-24). Основной файл — WAL+NORMAL.
      this.db.exec('PRAGMA journal_mode = MEMORY');
      this.db.exec('PRAGMA synchronous = OFF');
    } else {
      this.db.exec('PRAGMA journal_mode = WAL');
      this.db.exec('PRAGMA synchronous = NORMAL');
    }
    this.db.exec(SCHEMA);
    this.insertStmt = this.db.prepare(
      `INSERT INTO fts_msg (text, chat_id, topic_id, from_id, msg_id, date_iso)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
  }

  close(): void {
    this.db.close();
  }

  fileSizeBytes(): number {
    try {
      return statSync(this.path).size;
    } catch {
      return 0;
    }
  }

  getMaxIndexed(): number {
    const row = this.db.prepare(`SELECT value FROM fts_meta WHERE key = 'max_msg_id'`).get() as
      | { value: string }
      | undefined;
    return row ? Number(row.value) || 0 : 0;
  }

  setMaxIndexed(msgId: number): void {
    this.db
      .prepare(
        `INSERT INTO fts_meta (key, value) VALUES ('max_msg_id', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(String(msgId));
  }

  countDocs(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM fts_msg').get() as { n: number };
    return row.n;
  }

  /** Батч-вставка в одной транзакции (батчи по ~5k — курсор в tg-fts живёт). */
  indexRows(rows: ReadonlyArray<TgMessageRow>): void {
    if (rows.length === 0) return;
    this.db.exec('BEGIN');
    try {
      for (const r of rows) {
        this.insertStmt.run(r.text, r.chat_id, r.topic_id, r.from_id, r.msg_id, r.date_iso);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * MATCH-поиск по чату (опц. по автору). Возврат — кандидаты в порядке bm25
   * (лучшие раньше); финальный ранжинг (реакции+свежесть) делает бот поверх join.
   * Невалидный MATCH-синтаксис бросает — вызывающий отдаёт человекочитаемый ответ.
   */
  search(chatKey: string, matchQuery: string, fromId: string | null, limit: number): FtsHit[] {
    const where =
      fromId !== null
        ? 'WHERE fts_msg MATCH ? AND chat_id = ? AND from_id = ?'
        : 'WHERE fts_msg MATCH ? AND chat_id = ?';
    const args: Array<string | number> =
      fromId !== null ? [matchQuery, chatKey, fromId, limit] : [matchQuery, chatKey, limit];
    const rows = this.db
      .prepare(
        `SELECT topic_id, msg_id, from_id FROM fts_msg ${where} ORDER BY rank LIMIT ?`,
      )
      .all(...args) as unknown as Array<{ topic_id: number; msg_id: number; from_id: string }>;
    return rows.map((r) => ({ topicId: r.topic_id, msgId: r.msg_id, fromId: r.from_id }));
  }
}
