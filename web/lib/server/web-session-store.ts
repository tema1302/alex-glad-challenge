// web-sessions.sqlite — персистентное состояние chat-агента (день 28, web P2).
//
// RAM-only состояние REPL (short-term история, working facts, usage, active profile,
// system, branching-ветки) выносится сюда, чтобы web-сессия переживала reload/restart.
// Long-term memory / profiles / constraints хранятся в СВОИХ файлах (.data/memory.json,
// .data/profiles/*, .data/constraints.json) через core/ классы — НЕ здесь. Этот store
// держит только то, что core/ негде (plan §5A).
//
// node:sqlite DatabaseSync (синхронный, WAL). ВСЕ запросы — parameterized (?-плейсхолдеры).
// Строковая интерполяция/конкатенация в SQL ЗАПРЕЩЕНА (CLAUDE.md SQLi-инвариант).
// Singleton живёт один на процесс; обращения оборачиваются в withDb (serial-mutex db.ts).
import 'server-only';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { dataPath } from './challenge';
import { withDb } from './db';

// Зеркало repl.ts STRATEGY_NAMES — единый источник правды в forms.ts (strategyNameSchema).
export type StrategyName = 'full' | 'sliding' | 'sticky' | 'branching';

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts: string;
}

export interface SessionData {
  id: string;
  strategy: StrategyName;
  system: string;
  activeProfile: string | null;
  windowSize: number;
  memoryEnabled: boolean;
  usage: Usage;
  messages: SessionMessage[];
  working: Record<string, string>;
  task: string | null;
}

export interface SessionListItem {
  id: string;
  strategy: StrategyName;
  system: string;
  memoryEnabled: boolean;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

const EMPTY_USAGE: Usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

const DEFAULT_SYSTEM = 'Ты — ассистент. Отвечай кратко и по делу.';

let store: WebSessionStore | null = null;

export function getWebSessionStore(): WebSessionStore {
  if (!store) store = new WebSessionStore(dataPath('web-sessions.sqlite'));
  return store;
}

export class WebSessionStore {
  private db: DatabaseSync;

  constructor(filePath: string) {
    this.db = new DatabaseSync(filePath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS web_sessions (
        id TEXT PRIMARY KEY,
        strategy TEXT NOT NULL DEFAULT 'full',
        system_prompt TEXT NOT NULL DEFAULT '',
        active_profile TEXT,
        window_size INTEGER NOT NULL DEFAULT 10,
        usage_json TEXT NOT NULL DEFAULT '{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0}',
        memory_enabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS web_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        ts TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS web_branches (
        session_id TEXT NOT NULL,
        id INTEGER NOT NULL,
        label TEXT,
        parent_id INTEGER,
        messages_json TEXT,
        active INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (session_id, id)
      );
      CREATE TABLE IF NOT EXISTS web_working (
        session_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (session_id, key)
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  // --- Sessions ---

  createSession(opts: {
    strategy?: StrategyName;
    system?: string;
    windowSize?: number;
    memoryEnabled?: boolean;
    activeProfile?: string | null;
  } = {}): string {
    const id = `s-${randomUUID()}`;
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO web_sessions
         (id, strategy, system_prompt, active_profile, window_size, usage_json, memory_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      opts.strategy ?? 'full',
      opts.system ?? DEFAULT_SYSTEM,
      opts.activeProfile ?? null,
      opts.windowSize ?? 10,
      JSON.stringify(EMPTY_USAGE),
      opts.memoryEnabled ? 1 : 0,
      now,
      now,
    );
    return id;
  }

  listSessions(): SessionListItem[] {
    const rows = this.db.prepare(
      `SELECT s.id AS id, s.strategy AS strategy, s.system_prompt AS system_prompt,
              s.memory_enabled AS memory_enabled, s.created_at AS created_at,
              s.updated_at AS updated_at,
              (SELECT COUNT(*) FROM web_messages m WHERE m.session_id = s.id) AS msg_count
       FROM web_sessions s
       ORDER BY s.updated_at DESC`,
    ).all() as Array<{
      id: string; strategy: StrategyName; system_prompt: string;
      memory_enabled: number; created_at: string; updated_at: string; msg_count: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      strategy: r.strategy,
      system: r.system_prompt,
      memoryEnabled: r.memory_enabled === 1,
      messageCount: r.msg_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  private getMetaRow(sessionId: string): {
    id: string; strategy: StrategyName; system_prompt: string; active_profile: string | null;
    window_size: number; usage_json: string; memory_enabled: number;
  } | null {
    return (this.db.prepare(
      `SELECT id, strategy, system_prompt, active_profile, window_size, usage_json, memory_enabled
       FROM web_sessions WHERE id = ?`,
    ).get(sessionId) as ReturnType<typeof this.getMetaRow>) ?? null;
  }

  load(sessionId: string): SessionData | null {
    const meta = this.getMetaRow(sessionId);
    if (!meta) return null;
    // Branching: сообщения живут в web_branches (активная ветка), не в web_messages.
    // ensureMainBranch сеет main из web_messages при первом доступе (back-compat с P2a).
    let messages: SessionMessage[];
    if (meta.strategy === 'branching') {
      this.ensureMainBranch(sessionId);
      const activeId = this.getActiveBranchId(sessionId) ?? 0;
      messages = this.getBranchMessages(sessionId, activeId);
    } else {
      const messageRows = this.db.prepare(
        `SELECT role, content, ts FROM web_messages WHERE session_id = ? ORDER BY id ASC`,
      ).all(sessionId) as Array<{ role: string; content: string; ts: string }>;
      messages = messageRows.map((r) => ({
        role: r.role as SessionMessage['role'],
        content: r.content,
        ts: r.ts,
      }));
    }
    const workingRows = this.db.prepare(
      `SELECT key, value FROM web_working WHERE session_id = ?`,
    ).all(sessionId) as Array<{ key: string; value: string }>;
    const working: Record<string, string> = {};
    for (const w of workingRows) working[w.key] = w.value;
    const task = working['__task__'] ?? null;
    delete working['__task__'];
    let usage: Usage = EMPTY_USAGE;
    try {
      usage = JSON.parse(meta.usage_json) as Usage;
    } catch {
      usage = { ...EMPTY_USAGE };
    }
    return {
      id: meta.id,
      strategy: meta.strategy,
      system: meta.system_prompt,
      activeProfile: meta.active_profile,
      windowSize: meta.window_size,
      memoryEnabled: meta.memory_enabled === 1,
      usage,
      messages,
      working,
      task,
    };
  }

  appendMessage(sessionId: string, role: 'user' | 'assistant' | 'system', content: string): void {
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO web_messages (session_id, role, content, ts) VALUES (?, ?, ?, ?)`,
    ).run(sessionId, role, content, now);
    this.touch(sessionId);
  }

  clearMessages(sessionId: string): void {
    this.db.prepare(`DELETE FROM web_messages WHERE session_id = ?`).run(sessionId);
    this.touch(sessionId);
  }

  updateSession(
    sessionId: string,
    patch: {
      strategy?: StrategyName;
      system?: string;
      windowSize?: number;
      memoryEnabled?: boolean;
      activeProfile?: string | null;
      usage?: Usage;
    },
  ): void {
    const meta = this.getMetaRow(sessionId);
    if (!meta) return;
    const strategy = patch.strategy ?? meta.strategy;
    const system = patch.system ?? meta.system_prompt;
    const windowSize = patch.windowSize ?? meta.window_size;
    const memoryEnabled = patch.memoryEnabled ?? meta.memory_enabled === 1;
    const activeProfile = patch.activeProfile !== undefined ? patch.activeProfile : meta.active_profile;
    const usage = patch.usage ?? JSON.parse(meta.usage_json) as Usage;
    this.db.prepare(
      `UPDATE web_sessions
       SET strategy = ?, system_prompt = ?, window_size = ?, memory_enabled = ?,
           active_profile = ?, usage_json = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      strategy,
      system,
      windowSize,
      memoryEnabled ? 1 : 0,
      activeProfile,
      JSON.stringify(usage),
      new Date().toISOString(),
      sessionId,
    );
  }

  deleteSession(sessionId: string): boolean {
    this.db.prepare(`DELETE FROM web_messages WHERE session_id = ?`).run(sessionId);
    this.db.prepare(`DELETE FROM web_branches WHERE session_id = ?`).run(sessionId);
    this.db.prepare(`DELETE FROM web_working WHERE session_id = ?`).run(sessionId);
    const r = this.db.prepare(`DELETE FROM web_sessions WHERE id = ?`).run(sessionId);
    return r.changes > 0;
  }

  // --- Working memory (task/facts) — P2b mutations ---

  upsertWorking(sessionId: string, key: string, value: string): void {
    this.db.prepare(
      `INSERT INTO web_working (session_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(session_id, key) DO UPDATE SET value = excluded.value`,
    ).run(sessionId, key, value);
    this.touch(sessionId);
  }

  deleteWorking(sessionId: string, key: string): boolean {
    const r = this.db.prepare(
      `DELETE FROM web_working WHERE session_id = ? AND key = ?`,
    ).run(sessionId, key);
    this.touch(sessionId);
    return r.changes > 0;
  }

  clearWorking(sessionId: string): void {
    this.db.prepare(`DELETE FROM web_working WHERE session_id = ?`).run(sessionId);
    this.touch(sessionId);
  }

  // --- Branches (branching-стратегия) — P2b ---

  listBranches(sessionId: string): Array<{
    id: number; label: string; parentId: number | null; active: boolean; messageCount: number;
  }> {
    const rows = this.db.prepare(
      `SELECT id, label, parent_id, active, messages_json FROM web_branches WHERE session_id = ? ORDER BY id ASC`,
    ).all(sessionId) as Array<{
      id: number; label: string | null; parent_id: number | null; active: number; messages_json: string | null;
    }>;
    return rows.map((r) => {
      let messageCount = 0;
      if (r.messages_json) {
        try {
          messageCount = (JSON.parse(r.messages_json) as unknown[]).length;
        } catch {
          messageCount = 0;
        }
      }
      return {
        id: r.id,
        label: r.label ?? `branch-${r.id}`,
        parentId: r.parent_id,
        active: r.active === 1,
        messageCount,
      };
    });
  }

  saveBranch(sessionId: string, branch: {
    id: number; label: string; parentId: number | null;
    messages: SessionMessage[]; active: boolean;
  }): void {
    this.db.prepare(
      `INSERT INTO web_branches (session_id, id, label, parent_id, messages_json, active)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, id) DO UPDATE SET
         label = excluded.label, parent_id = excluded.parent_id,
         messages_json = excluded.messages_json, active = excluded.active`,
    ).run(
      sessionId,
      branch.id,
      branch.label,
      branch.parentId,
      JSON.stringify(branch.messages),
      branch.active ? 1 : 0,
    );
    this.touch(sessionId);
  }

  // Bulk-upsert веток убран (orphan от stalled Fix P2b; ни в web/, ни в challenge/
  // не вызывался — saveBranch(единственный) покрывает все случаи).

  getActiveBranchId(sessionId: string): number | null {
    const row = this.db.prepare(
      `SELECT id FROM web_branches WHERE session_id = ? AND active = 1 LIMIT 1`,
    ).get(sessionId) as { id: number } | undefined;
    return row?.id ?? null;
  }

  setActiveBranch(sessionId: string, id: number): void {
    this.db.prepare(
      `UPDATE web_branches SET active = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE session_id = ?`,
    ).run(id, sessionId);
    this.touch(sessionId);
  }

  getBranchMessages(sessionId: string, id: number): SessionMessage[] {
    const row = this.db.prepare(
      `SELECT messages_json FROM web_branches WHERE session_id = ? AND id = ?`,
    ).get(sessionId, id) as { messages_json: string | null } | undefined;
    if (!row || !row.messages_json) return [];
    try {
      return JSON.parse(row.messages_json) as SessionMessage[];
    } catch {
      return [];
    }
  }

  // Дописать реплику в АКТИВНУЮ ветку (branching-flush). Не трогает web_messages —
  // для branching источником истории служит web_branches (см. load()).
  appendBranchMessage(sessionId: string, role: 'user' | 'assistant' | 'system', content: string): void {
    const activeId = this.getActiveBranchId(sessionId);
    if (activeId === null) return;
    const meta = this.listBranches(sessionId).find((b) => b.id === activeId);
    const msgs = this.getBranchMessages(sessionId, activeId);
    msgs.push({ role, content, ts: new Date().toISOString() });
    this.saveBranch(sessionId, {
      id: activeId,
      label: meta?.label ?? `branch-${activeId}`,
      parentId: meta?.parentId ?? null,
      messages: msgs,
      active: true,
    });
  }

  // Гарантирует наличие main-ветки (id=0) для branching-сессии. При первом доступе
  // сеет её сообщениями из web_messages (back-compat с P2a, где branching был линейным).
  // Идемпотентна. НЕ вызывается вне withDb.
  ensureMainBranch(sessionId: string): void {
    const existing = this.listBranches(sessionId);
    if (existing.length > 0) return;
    const rows = this.db.prepare(
      `SELECT role, content, ts FROM web_messages WHERE session_id = ? ORDER BY id ASC`,
    ).all(sessionId) as Array<{ role: string; content: string; ts: string }>;
    const messages: SessionMessage[] = rows.map((r) => ({
      role: r.role as SessionMessage['role'], content: r.content, ts: r.ts,
    }));
    this.saveBranch(sessionId, { id: 0, label: 'main', parentId: null, messages, active: true });
  }

  private touch(sessionId: string): void {
    this.db.prepare(`UPDATE web_sessions SET updated_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), sessionId);
  }
}

// Создаёт дефолтную сессию, если в store ещё ничего нет. Возвращает её id.
export function ensureDefaultSession(): Promise<string> {
  return withDb(() => {
    const s = getWebSessionStore();
    const list = s.listSessions();
    if (list.length > 0) return list[0].id;
    return s.createSession();
  });
}
