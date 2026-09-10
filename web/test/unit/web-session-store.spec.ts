// WebSessionStore — персистентное состояние chat-агента: реальный node:sqlite
// во временной папке (без dataPath-синглтона, конструктор принимает путь).
// CRUD сессий, сообщения, working-память, ветки, изоляция joker-префикса.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WebSessionStore } from '../../lib/server/web-session-store';

const DIRS: string[] = [];
const STORES: WebSessionStore[] = [];

function makeStore(): { store: WebSessionStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'web-sessions-'));
  DIRS.push(dir);
  const store = new WebSessionStore(join(dir, 'test.sqlite'));
  STORES.push(store);
  return { store, dir };
}

afterEach(() => {
  STORES.splice(0).forEach((s) => {
    try {
      s.close();
    } catch {
      /* уже закрыт в тесте */
    }
  });
  for (const d of DIRS.splice(0)) {
    // Windows: sqlite WAL-файлы могут отпустить лок с задержкой — cleanup best-effort.
    try {
      rmSync(d, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {
      /* tmp-мусор не влияет на результат */
    }
  }
});

describe('сессии — создание и список', () => {
  it('createSession: дефолты (strategy=full, system, window=10, usage нули)', () => {
    const { store } = makeStore();
    const id = store.createSession();
    expect(id.startsWith('s-')).toBe(true);

    const s = store.load(id)!;
    expect(s.strategy).toBe('full');
    expect(s.system).toContain('ассистент');
    expect(s.windowSize).toBe(10);
    expect(s.memoryEnabled).toBe(false);
    expect(s.usage).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    expect(s.messages).toEqual([]);
    expect(s.working).toEqual({});
    expect(s.task).toBeNull();
    store.close();
  });

  it('createSession: кастомные опции применяются', () => {
    const { store } = makeStore();
    const id = store.createSession({
      strategy: 'sliding',
      system: 'Ты — ревьюер',
      windowSize: 42,
      memoryEnabled: true,
      activeProfile: 'dev',
    });
    const s = store.load(id)!;
    expect(s.strategy).toBe('sliding');
    expect(s.system).toBe('Ты — ревьюер');
    expect(s.windowSize).toBe(42);
    expect(s.memoryEnabled).toBe(true);
    expect(s.activeProfile).toBe('dev');
    store.close();
  });

  it('createJokerSession: префикс j-, sliding/12, память выключена', () => {
    const { store } = makeStore();
    const id = store.createJokerSession({ system: 'Шутник' });
    expect(id.startsWith('j-')).toBe(true);
    const s = store.load(id)!;
    expect(s.strategy).toBe('sliding');
    expect(s.windowSize).toBe(12);
    expect(s.memoryEnabled).toBe(false);
    store.close();
  });

  it('listSessions: сортировка по updated_at DESC и фильтр по префиксу', () => {
    const { store } = makeStore();
    const a = store.createSession();
    const j = store.createJokerSession({ system: 'x' });
    store.appendMessage(a, 'user', 'обновляет a');

    expect(store.listSessions('s-').map((i) => i.id)).toEqual([a]);
    expect(store.listSessions('j-').map((i) => i.id)).toEqual([j]);

    const all = store.listSessions();
    expect(new Set(all.map((i) => i.id))).toEqual(new Set([a, j]));
    expect(all[0].id).toBe(a); // a тронут appendMessage → свежий updated_at
    expect(all.find((i) => i.id === a)!.messageCount).toBe(1);
    store.close();
  });

  it('listSessions: messageCount считается по web_messages', () => {
    const { store } = makeStore();
    const a = store.createSession();
    store.appendMessage(a, 'user', 'раз');
    store.appendMessage(a, 'assistant', 'два');
    expect(store.listSessions('s-')[0].messageCount).toBe(2);
    store.close();
  });

  it('load неизвестной сессии → null', () => {
    const { store } = makeStore();
    expect(store.load('s-нет-такой')).toBeNull();
    store.close();
  });
});

describe('сообщения и updateSession', () => {
  it('appendMessage сохраняет порядок, clearMessages чистит', () => {
    const { store } = makeStore();
    const id = store.createSession();
    store.appendMessage(id, 'user', 'вопрос');
    store.appendMessage(id, 'assistant', 'ответ');
    const s = store.load(id)!;
    expect(s.messages.map((m) => m.content)).toEqual(['вопрос', 'ответ']);
    expect(s.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    for (const m of s.messages) expect(() => new Date(m.ts)).not.toThrow();

    store.clearMessages(id);
    expect(store.load(id)!.messages).toEqual([]);
    store.close();
  });

  it('updateSession патчит только переданные поля, usage сериализуется', () => {
    const { store } = makeStore();
    const id = store.createSession({ system: 'до', windowSize: 10 });
    store.appendMessage(id, 'user', 'сохранное сообщение');

    store.updateSession(id, { strategy: 'sticky', usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } });
    const s = store.load(id)!;
    expect(s.strategy).toBe('sticky');
    expect(s.system).toBe('до'); // не передано → прежнее
    expect(s.windowSize).toBe(10);
    expect(s.usage).toEqual({ prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 });
    expect(s.messages).toHaveLength(1);
    store.close();
  });

  it('updateSession может снять activeProfile и переключить память', () => {
    const { store } = makeStore();
    const id = store.createSession({ activeProfile: 'dev', memoryEnabled: true });
    store.updateSession(id, { activeProfile: null, memoryEnabled: false });
    const s = store.load(id)!;
    expect(s.activeProfile).toBeNull();
    expect(s.memoryEnabled).toBe(false);
    store.close();
  });

  it('updateSession неизвестной сессии — тихий no-op', () => {
    const { store } = makeStore();
    expect(() => store.updateSession('s-призрак', { strategy: 'sticky' })).not.toThrow();
    store.close();
  });

  it('deleteSession: true + каскад таблиц; повторно — false', () => {
    const { store } = makeStore();
    const id = store.createSession({ strategy: 'branching' });
    store.appendMessage(id, 'user', 'история');
    store.ensureMainBranch(id);
    store.upsertWorking(id, 'goal', 'тест');

    expect(store.deleteSession(id)).toBe(true);
    expect(store.deleteSession(id)).toBe(false);
    expect(store.load(id)).toBeNull();
    expect(store.listBranches(id)).toEqual([]);
    store.close();
  });
});

describe('working-память', () => {
  it('upsert: вставка и перезапись ключа; __task__ выносится в task', () => {
    const { store } = makeStore();
    const id = store.createSession();
    store.upsertWorking(id, 'color', 'синий');
    store.upsertWorking(id, 'color', 'красный');
    store.upsertWorking(id, '__task__', 'собрать дайджест');

    const s = store.load(id)!;
    expect(s.working.color).toBe('красный');
    expect(s.task).toBe('собрать дайджест');
    expect(s.working['__task__']).toBeUndefined();
    store.close();
  });

  it('deleteWorking возвращает true только на существующем ключе', () => {
    const { store } = makeStore();
    const id = store.createSession();
    store.upsertWorking(id, 'k', 'v');
    expect(store.deleteWorking(id, 'k')).toBe(true);
    expect(store.deleteWorking(id, 'k')).toBe(false);
    store.close();
  });

  it('clearWorking чистит и task, и факты', () => {
    const { store } = makeStore();
    const id = store.createSession();
    store.upsertWorking(id, 'k', 'v');
    store.upsertWorking(id, '__task__', 't');
    store.clearWorking(id);
    const s = store.load(id)!;
    expect(s.working).toEqual({});
    expect(s.task).toBeNull();
    store.close();
  });
});

describe('ветки (branching)', () => {
  it('ensureMainBranch сеет main из web_messages и идемпотентна', () => {
    const { store } = makeStore();
    const id = store.createSession({ strategy: 'branching' });
    store.appendMessage(id, 'user', 'корень');

    store.ensureMainBranch(id);
    const branches = store.listBranches(id);
    expect(branches).toHaveLength(1);
    expect(branches[0].label).toBe('main');
    expect(branches[0].active).toBe(true);
    expect(branches[0].messageCount).toBe(1);

    store.ensureMainBranch(id); // повторный вызов не плодит веток
    expect(store.listBranches(id)).toHaveLength(1);
    store.close();
  });

  it('load branching-сессии берёт сообщения из активной ветки', () => {
    const { store } = makeStore();
    const id = store.createSession({ strategy: 'branching' });
    store.appendMessage(id, 'user', 'в web_messages');
    // Первый load() сеет main (id 0) из web_messages — как это делает /chat.
    const seeded = store.load(id)!;
    expect(seeded.messages.map((m) => m.content)).toEqual(['в web_messages']);
    expect(seeded.messages).toEqual(store.getBranchMessages(id, 0));

    // Новая ветка 1 без сообщений + активация
    store.saveBranch(id, { id: 1, label: 'пробуем иначе', parentId: 0, messages: [], active: false });
    store.setActiveBranch(id, 1);
    expect(store.load(id)!.messages).toEqual([]);

    store.appendBranchMessage(id, 'user', 'в ветке');
    store.appendBranchMessage(id, 'assistant', 'ответ ветки');
    const msgs = store.load(id)!.messages;
    expect(msgs.map((m) => m.content)).toEqual(['в ветке', 'ответ ветки']);
    // web_messages не тронуты appendBranchMessage: main-ветка всё ещё с одним сообщением
    expect(store.listBranches(id).find((b) => b.id === 0)!.messageCount).toBe(1);
    store.close();
  });

  it('saveBranch upsert: перезапись метки/сообщений/active', () => {
    const { store } = makeStore();
    const id = store.createSession({ strategy: 'branching' });
    store.saveBranch(id, { id: 2, label: 'было', parentId: null, messages: [], active: false });
    store.saveBranch(id, { id: 2, label: 'стало', parentId: 0, messages: [
      { role: 'user', content: 'привет', ts: '2026-01-01T00:00:00.000Z' },
    ], active: true });

    const b = store.listBranches(id).find((x) => x.id === 2)!;
    expect(b.label).toBe('стало');
    expect(b.active).toBe(true);
    expect(b.messageCount).toBe(1);
    expect(store.getActiveBranchId(id)).toBe(2);
    store.close();
  });

  it('setActiveBranch: ровно одна активная', () => {
    const { store } = makeStore();
    const id = store.createSession({ strategy: 'branching' });
    store.ensureMainBranch(id);
    store.saveBranch(id, { id: 1, label: 'b1', parentId: 0, messages: [], active: false });
    store.setActiveBranch(id, 1);
    expect(store.getActiveBranchId(id)).toBe(1);
    store.setActiveBranch(id, 0);
    expect(store.getActiveBranchId(id)).toBe(0);
    store.close();
  });

  it('getBranchMessages: битый JSON → пустой список, без выброса', () => {
    const { store, dir } = makeStore();
    const id = store.createSession({ strategy: 'branching' });
    store.saveBranch(id, { id: 9, label: 'x', parentId: null, messages: [], active: false });
    // Портим messages_json второй выборкой к тому же файлу (store-поле приватно).
    const raw = new DatabaseSync(join(dir, 'test.sqlite'));
    raw.prepare(`UPDATE web_branches SET messages_json = '{сломано' WHERE id = 9`).run();
    raw.close();
    expect(store.getBranchMessages(id, 9)).toEqual([]);
    expect(store.getBranchMessages(id, 999)).toEqual([]); // нет ветки
    store.close();
  });

  it('appendBranchMessage без активной ветки — no-op', () => {
    const { store } = makeStore();
    const id = store.createSession({ strategy: 'branching' });
    // Веток нет вовсе → ensureMainBranch при load создаст, но append не должен упасть.
    expect(() => store.appendBranchMessage(id, 'user', 'никуда')).not.toThrow();
    store.close();
  });
});
