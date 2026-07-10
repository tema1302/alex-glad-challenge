// Chat-mutations: mutations памяти/веток/профиля/инвариантов поверх персистентной
// web-сессии (день 28, web P2b). Каждая функция: load/hydrate core/-объекта → mutate →
// persist. Обращения к .data/ — под withDb (serial-mutex db.ts).
//
// Разделение персистента:
//   - long-term memory, profiles, constraints — ГЛОБАЛЬНЫЕ файлы (.data/memory.json,
//     .data/profiles/*, .data/constraints.json), разделяются между сессиями (как в repl):
//     одна память/профиль/инварианты на ассистента.
//   - working/task/memory_enabled/active_profile/ветки — per-session в web-sessions.sqlite.
//
// server-only: все импорты core/ через web/lib/server/challenge.ts chokepoint.
import 'server-only';
import {
  Memory,
  ProfileManager,
  Constraints,
  clean,
  dataPath,
  type ConstraintType,
  type Constraint,
  type UserProfile,
} from './challenge';
import { getWebSessionStore } from './web-session-store';
import { withDb } from './db';
import { pickLlmClient, type LlmPref } from './llm';

// ====================== Memory (3 слоя) ======================

export interface MemorySnapshotView {
  memoryEnabled: boolean;
  task: string | null;
  working: Record<string, string>;
  longTerm: Array<{ key: string; value: string; updatedAt: string }>;
}

// Гидратация snapshot'а для GET /memory. longTerm — глобальный (memory.json);
// task/working/memoryEnabled — per-session.
export async function memorySnapshot(sessionId: string): Promise<MemorySnapshotView> {
  return withDb(() => {
    const m = new Memory({ filePath: dataPath('memory.json') });
    m.loadLongTerm();
    const snap = m.snapshot();
    const data = getWebSessionStore().load(sessionId);
    return {
      memoryEnabled: data?.memoryEnabled ?? false,
      task: data?.task ?? null,
      working: data?.working ?? {},
      longTerm: snap.longTermEntries,
    };
  });
}

// /remember key,value → long-term + saveLongTerm. Side-effect: memory mode ON (repl parity).
export async function memoryRemember(sessionId: string, key: string, value: string): Promise<void> {
  await withDb(() => {
    const m = new Memory({ filePath: dataPath('memory.json') });
    m.loadLongTerm();
    m.remember(key, value);
    m.saveLongTerm();
    getWebSessionStore().updateSession(sessionId, { memoryEnabled: true });
  });
}

// /forget key → long-term remove + saveLongTerm. (sessionId не используется — long-term глобален;
// сохранён в сигнатуре для консистентности с другими memory-mutations.)
export async function memoryForget(_sessionId: string, key: string): Promise<boolean> {
  return withDb(() => {
    const m = new Memory({ filePath: dataPath('memory.json') });
    m.loadLongTerm();
    const removed = m.forget(key);
    m.saveLongTerm();
    return removed;
  });
}

// /task <desc> → persist в web_working под '__task__'. Side-effect: memory mode ON.
export async function memorySetTask(sessionId: string, description: string): Promise<void> {
  await withDb(() => {
    getWebSessionStore().upsertWorking(sessionId, '__task__', description);
    getWebSessionStore().updateSession(sessionId, { memoryEnabled: true });
  });
}

// /task-add key,value → working fact. Side-effect: memory mode ON.
export async function memoryAddFact(sessionId: string, key: string, value: string): Promise<void> {
  await withDb(() => {
    getWebSessionStore().upsertWorking(sessionId, key, value);
    getWebSessionStore().updateSession(sessionId, { memoryEnabled: true });
  });
}

// remove single working fact (UI rm; расширение над repl — repl не удаляет один факт).
export async function memoryRemoveFact(sessionId: string, key: string): Promise<boolean> {
  return withDb(() => getWebSessionStore().deleteWorking(sessionId, key));
}

// /task-clear → очистка task + working facts.
export async function memoryClearWorking(sessionId: string): Promise<void> {
  await withDb(() => getWebSessionStore().clearWorking(sessionId));
}

// /memory-on | /memory-off
export async function memorySetEnabled(sessionId: string, enabled: boolean): Promise<void> {
  await withDb(() => getWebSessionStore().updateSession(sessionId, { memoryEnabled: enabled }));
}

// ====================== Branching ======================

export interface BranchView {
  id: number;
  label: string;
  parentId: number | null;
  active: boolean;
  messageCount: number;
}
export interface BranchesView {
  branches: BranchView[];
  activeId: number;
}

function branchView(sessionId: string): BranchesView {
  const s = getWebSessionStore();
  s.ensureMainBranch(sessionId);
  const branches = s.listBranches(sessionId);
  const activeId = s.getActiveBranchId(sessionId) ?? 0;
  return { branches, activeId };
}

// /branch [label] → checkpoint активной ветки (snapshot). НЕ переключается (repl parity).
// Возвращает id новой ветки и обновлённый список.
export async function branchCheckpoint(sessionId: string, label?: string): Promise<{ branchId: number; view: BranchesView }> {
  return withDb(() => {
    const s = getWebSessionStore();
    s.ensureMainBranch(sessionId);
    const branches = s.listBranches(sessionId);
    const activeId = s.getActiveBranchId(sessionId) ?? 0;
    const activeMsgs = s.getBranchMessages(sessionId, activeId);
    // id = текущее число веток (семантика Branching.checkpoint: id = branches.length).
    const newId = branches.length;
    const newLabel = label?.trim() || `branch-${newId}`;
    // Новая ветка = snapshot активной; active=false ( остаёмся на текущей).
    s.saveBranch(sessionId, {
      id: newId,
      label: newLabel,
      parentId: activeId,
      messages: [...activeMsgs],
      active: false,
    });
    return { branchId: newId, view: branchView(sessionId) };
  });
}

// /switch <id> → сделать ветку активной.
export async function branchSwitch(sessionId: string, id: number): Promise<BranchesView> {
  return withDb(() => {
    const s = getWebSessionStore();
    s.ensureMainBranch(sessionId);
    const branches = s.listBranches(sessionId);
    if (!branches.some((b) => b.id === id)) {
      throw new Error(`Ветка id=${id} не найдена. Доступно: ${branches.map((b) => b.id).join(', ')}`);
    }
    s.setActiveBranch(sessionId, id);
    return branchView(sessionId);
  });
}

// GET /branch — список веток + active.
export async function branchList(sessionId: string): Promise<BranchesView> {
  return withDb(() => branchView(sessionId));
}

// ====================== Profile ======================

export interface ProfileView {
  profiles: string[];
  active: string | null;
  snapshot: UserProfile | null;
}

function resolveActiveProfileName(sessionId: string): string | null {
  const pm = new ProfileManager(dataPath('profiles'));
  const profiles = pm.list();
  const data = getWebSessionStore().load(sessionId);
  if (data?.activeProfile && profiles.includes(data.activeProfile)) return data.activeProfile;
  if (profiles.length > 0) return profiles.includes('default') ? 'default' : profiles[0];
  return null;
}

// GET /profile — список + активный + snapshot активного.
export async function profileList(sessionId: string): Promise<ProfileView> {
  return withDb(() => {
    const pm = new ProfileManager(dataPath('profiles'));
    const profiles = pm.list();
    const active = resolveActiveProfileName(sessionId);
    let snapshot: UserProfile | null = null;
    if (active) {
      pm.load(active);
      snapshot = pm.snapshot();
    }
    return { profiles, active, snapshot };
  });
}

// /profile-use <name> → загрузить профиль, зафиксировать как activeProfile сессии.
export async function profileUse(sessionId: string, name: string): Promise<void> {
  await withDb(() => {
    const pm = new ProfileManager(dataPath('profiles'));
    if (!pm.load(name)) {
      throw new Error(`Профиль "${name}" не найден. /profile list — список.`);
    }
    getWebSessionStore().updateSession(sessionId, { activeProfile: name });
  });
}

// /profile-edit <instruction> → editViaLLM (async, LLM). instruction sanitize через clean()
// перед передачей в LLM. Требует активный профиль. Возвращает summary изменений.
export async function profileEdit(sessionId: string, instruction: string, llm: LlmPref): Promise<string> {
  const cleanInstr = clean(instruction, 2000);
  const activeName = await withDb(() => resolveActiveProfileName(sessionId));
  if (!activeName) throw new Error('Нет активного профиля. Сначала /profile-new или /profile-use.');
  // LLM-вызов — БЕЗ mutex (не блокируем .data/-очередь на секунды); editViaLLM сам save'ит.
  const pm = new ProfileManager(dataPath('profiles'));
  pm.load(activeName);
  const client = pickLlmClient(llm);
  return pm.editViaLLM(cleanInstr, client);
}

// /profile-new <name> [base] → создать (defaults ИЛИ копия base). activeProfile = new.
export async function profileNew(sessionId: string, name: string, baseName?: string): Promise<void> {
  await withDb(() => {
    const pm = new ProfileManager(dataPath('profiles'));
    if (baseName) {
      const src = new ProfileManager(dataPath('profiles'));
      if (!src.load(baseName)) throw new Error(`Базовый профиль "${baseName}" не найден.`);
      pm.create(name, src.snapshot());
    } else {
      pm.create(name);
    }
    getWebSessionStore().updateSession(sessionId, { activeProfile: name });
  });
}

// /profile-copy <newName> → копия активного.
export async function profileCopy(sessionId: string, newName: string): Promise<void> {
  await withDb(() => {
    const active = resolveActiveProfileName(sessionId);
    if (!active) throw new Error('Нет активного профиля для копирования.');
    const pm = new ProfileManager(dataPath('profiles'));
    pm.load(active);
    if (!pm.copy(newName)) throw new Error(`Не удалось создать копию "${newName}".`);
    getWebSessionStore().updateSession(sessionId, { activeProfile: newName });
  });
}

// /profile-note <text> → заметка к активному профилю.
export async function profileNote(sessionId: string, text: string): Promise<void> {
  await withDb(() => {
    const active = resolveActiveProfileName(sessionId);
    if (!active) throw new Error('Нет активного профиля.');
    const pm = new ProfileManager(dataPath('profiles'));
    pm.load(active);
    pm.addNote(clean(text, 2000));
  });
}

// /profile-reset → сброс активного к defaults + save.
export async function profileReset(sessionId: string): Promise<void> {
  await withDb(() => {
    const active = resolveActiveProfileName(sessionId);
    if (!active) throw new Error('Нет активного профиля.');
    const pm = new ProfileManager(dataPath('profiles'));
    pm.load(active);
    pm.reset();
    pm.save();
  });
}

// /profile delete (опц.) — удалить профиль (не активный).
export async function profileDelete(_sessionId: string, name: string): Promise<void> {
  await withDb(() => {
    const pm = new ProfileManager(dataPath('profiles'));
    if (!pm.delete(name)) throw new Error(`Не удалось удалить "${name}" (не существует или активный).`);
  });
}

// ====================== Constraints ======================

// GET /constraints — все инварианты.
export async function constraintsList(): Promise<{ items: Constraint[] }> {
  return withDb(() => {
    const c = new Constraints(dataPath('constraints.json'));
    c.load();
    return { items: c.all };
  });
}

// /constraint add <type> <title>: <description>
export async function constraintAdd(type: ConstraintType, title: string, description: string): Promise<Constraint> {
  return withDb(() => {
    const c = new Constraints(dataPath('constraints.json'));
    c.load();
    return c.add(type, title, description); // persist внутри
  });
}

// /constraint rm <id>
export async function constraintRemove(id: string): Promise<boolean> {
  return withDb(() => {
    const c = new Constraints(dataPath('constraints.json'));
    c.load();
    return c.remove(id); // persist внутри
  });
}
