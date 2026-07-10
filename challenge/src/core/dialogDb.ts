// Персистентная память диалога для day-25 (мини-чат RAG): чаты, сообщения и
// task state (goal/термины/ограничения/уточнения). Хранится в SQLite через
// node:sqlite (без нативных сборок). Файл: challenge/.data/dialog.sqlite (вне git,
// ОТДЕЛЬНО от read-only rag.sqlite).
//
// Идиома копирована с core/db.ts (BlogDb) и core/rag/store.ts: mkdirSync →
// new DatabaseSync → PRAGMA WAL → exec(SCHEMA). Все SQL — строго `?`-плейсхолдеры;
// для динамического LIKE-поиска собираем в JS только строку из вопросительных
// знаков, значения идут параметрами. FK не включаем (как в store.ts).

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { clean } from './sanitize.js';

export interface ChatRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: number;
  chatId: string;
  role: string;
  content: string;
  ts: string;
}

// Сериализованное состояние задачи для одного чата. terms/constraints/clarifications
// хранятся как JSON-колонки (по образцу store.ts embedding-as-text).
export interface SerializedTaskState {
  goal: string | null;
  terms: Record<string, string>;
  constraints: string[];
  clarifications: string[];
}

// Найденная в прошлых диалогах Q&A-запись (только user-сообщения; ассистент-ответ
// подгружается отдельно через listMessageAfter по id).
export interface PastQaRow {
  id: number;
  chatId: string;
  role: string;
  content: string;
  ts: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(ts);

CREATE TABLE IF NOT EXISTS task_state (
  chat_id TEXT PRIMARY KEY,
  goal TEXT,
  terms TEXT,
  constraints TEXT,
  clarifications TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// Лимиты длин для clean(): защищают БД от раздувания и от контрольных символов.
const MAX_CONTENT = 8192;
const MAX_TITLE = 120;
const MAX_GOAL = 500;
const MAX_TERM = 200;

// Escape special LIKE characters so user input cannot break the pattern shape.
// Сам паттерн '%...%' строим в JS, биндим как параметр — это НЕ строковая
// интерполяция SQL, а конструирование значения параметра.
function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, (m) => '\\' + m);
}

export class DialogDb {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  createChat(id: string, title: string): void {
    this.db
      .prepare('INSERT INTO chats (id, title) VALUES (?, ?)')
      .run(id, clean(title, MAX_TITLE) || 'untitled');
  }

  listChats(limit = 50): (ChatRow & { msg_count: number })[] {
    return this.db
      .prepare(
        `SELECT c.id AS id, c.title AS title, c.created_at AS created_at, c.updated_at AS updated_at,
           (SELECT COUNT(*) FROM messages WHERE chat_id = c.id) AS msg_count
         FROM chats c ORDER BY c.updated_at DESC LIMIT ?`,
      )
      .all(limit) as unknown as (ChatRow & { msg_count: number })[];
  }

  getChat(id: string): ChatRow | null {
    const row = this.db.prepare('SELECT * FROM chats WHERE id = ?').get(id);
    return (row ?? null) as ChatRow | null;
  }

  renameChat(id: string, title: string): void {
    this.db.prepare('UPDATE chats SET title = ? WHERE id = ?').run(clean(title, MAX_TITLE), id);
  }

  touchChat(id: string): void {
    this.db
      .prepare("UPDATE chats SET updated_at = datetime('now') WHERE id = ?")
      .run(id);
  }

  appendMessage(chatId: string, role: 'user' | 'assistant', content: string): number {
    const result = this.db
      .prepare('INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)')
      .run(chatId, role, clean(content, MAX_CONTENT));
    return Number(result.lastInsertRowid);
  }

  listMessages(chatId: string, limit = 50): MessageRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, chat_id AS chatId, role, content, ts FROM messages
         WHERE chat_id = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(chatId, limit) as unknown as MessageRow[];
    return rows.reverse();
  }

  // Подгрузить сообщения с id > afterId в хронологическом порядке — для восстановления
  // ассистент-ответа на найденный past-Q&A user. Сортировка по id (монотонный) —
  // ts хранится с секундной точностью и может совпадать у соседних сообщений.
  listMessageAfter(chatId: string, afterId: number, limit: number): MessageRow[] {
    return this.db
      .prepare(
        `SELECT id, chat_id AS chatId, role, content, ts FROM messages
         WHERE chat_id = ? AND id > ? ORDER BY id ASC LIMIT ?`,
      )
      .all(chatId, afterId, limit) as unknown as MessageRow[];
  }

  countMessages(chatId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?')
      .get(chatId) as { n: number };
    return row.n;
  }

  upsertTaskState(chatId: string, state: SerializedTaskState): void {
    this.db
      .prepare(
        `INSERT INTO task_state (chat_id, goal, terms, constraints, clarifications, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(chat_id) DO UPDATE SET
           goal = excluded.goal,
           terms = excluded.terms,
           constraints = excluded.constraints,
           clarifications = excluded.clarifications,
           updated_at = datetime('now')`,
      )
      .run(
        chatId,
        state.goal ? clean(state.goal, MAX_GOAL) : null,
        JSON.stringify(clipKeys(state.terms)),
        JSON.stringify(state.constraints.map((c) => clean(c, MAX_TERM)).filter((c) => c.length > 0)),
        JSON.stringify(state.clarifications.map((c) => clean(c, MAX_TERM)).filter((c) => c.length > 0)),
      );
  }

  loadTaskState(chatId: string): SerializedTaskState | null {
    const row = this.db
      .prepare('SELECT goal, terms, constraints, clarifications FROM task_state WHERE chat_id = ?')
      .get(chatId) as { goal: string | null; terms: string | null; constraints: string | null; clarifications: string | null } | undefined;
    if (!row) return null;
    let terms: Record<string, string> = {};
    let constraints: string[] = [];
    let clarifications: string[] = [];
    try {
      if (row.terms) terms = JSON.parse(row.terms) as Record<string, string>;
    } catch { terms = {}; }
    try {
      if (row.constraints) constraints = JSON.parse(row.constraints) as string[];
    } catch { constraints = []; }
    try {
      if (row.clarifications) clarifications = JSON.parse(row.clarifications) as string[];
    } catch { clarifications = []; }
    return {
      goal: typeof row.goal === 'string' && row.goal.trim().length > 0 ? row.goal : null,
      terms,
      constraints,
      clarifications,
    };
  }

  clearTaskState(chatId: string): void {
    this.db.prepare('DELETE FROM task_state WHERE chat_id = ?').run(chatId);
  }

  // Past-Q&A retrieval: LIKE по content user-сообщений ВСЕХ чатов (кроме excludeChatId).
  // Каждый keyword — отдельный `?`-плейсхолдер; LOWER для case-insensitive на кириллице
  // (sqlite LIKE ASCII-only case-insensitive). ESCAPE '\' задаёт backslash как
  // escape-символ (без ESCAPE %/_ в пользовательском тексте ломали бы паттерн).
  searchPastQa(keywords: string[], excludeChatId: string, limit: number): PastQaRow[] {
    if (keywords.length === 0) return [];
    const patterns = keywords.map((k) => '%' + escapeLike(k.toLowerCase()) + '%');
    const ors = patterns.map(() => "LOWER(content) LIKE LOWER(?) ESCAPE '\\'").join(' OR ');
    const sql =
      'SELECT id, chat_id AS chatId, role, content, ts FROM messages ' +
      `WHERE chat_id != ? AND role = 'user' AND (${ors}) ` +
      'ORDER BY ts DESC LIMIT ?';
    const params: (string | number)[] = [excludeChatId, ...patterns, limit];
    return this.db.prepare(sql).all(...params) as unknown as PastQaRow[];
  }
}

// Ограничение длин ключей/значений terms перед JSON-сериализацией.
function clipKeys(terms: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(terms)) {
    const ck = clean(k, MAX_TERM);
    if (ck.length > 0 && typeof v === 'string') {
      out[ck] = clean(v, MAX_TERM);
    }
  }
  return out;
}
