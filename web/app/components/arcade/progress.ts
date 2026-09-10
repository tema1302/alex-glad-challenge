// Прогресс игрока аркады — чистая логика без React и без обращений к storage:
// XP за раунды, уровни, достижения. Сохранение/загрузка — в use-progress.ts
// ('use client'), чтобы модуль можно было юнит-тестировать в node-окружении
// и переиспользовать в любых играх. recordResult иммутабелен: вход не мутируется.

export type GameId = 'quiz' | 'layers' | 'stack' | 'sim';

export interface GameResult {
  game: GameId;
  /** Сколько сделано верно (ответы, карточки без осечек, решённые пазлы). */
  score: number;
  /** Размер раунда; для одиночных событий (пазл, выпуск) = 1. */
  total: number;
  /** Дополнительный XP сверх формулы (например, бонус «с первой попытки»). */
  bonusXp?: number;
}

export interface ProgressState {
  xp: number;
  /** Завершённые раунды по играм — считаются только финализированные (кнопка «Итог»). */
  plays: Partial<Record<GameId, number>>;
  /** Лучший score по каждой игре. */
  bests: Partial<Record<GameId, number>>;
  achievements: AchievementId[];
}

export const EMPTY_PROGRESS: ProgressState = {
  xp: 0,
  plays: {},
  bests: {},
  achievements: [],
};

/** XP за идеальный (100%) раунд игры; частичный результат — пропорционально. */
const XP_PERFECT: Record<GameId, number> = { quiz: 40, layers: 20, stack: 30, sim: 25 };

export function xpFor(result: GameResult): number {
  const base = XP_PERFECT[result.game] ?? 0;
  const total = Math.max(result.total, 0);
  const score = Math.min(Math.max(result.score, 0), total);
  const ratio = total > 0 ? score / total : 0;
  const bonus = result.bonusXp && result.bonusXp > 0 ? result.bonusXp : 0;
  return Math.round(ratio * base) + bonus;
}

// ── Уровни ───────────────────────────────────────────────────────────────────

/** Порог XP начала уровня: LEVELS[0] = уровень 1, … верхний индекс — максимальный. */
export const LEVEL_THRESHOLDS: readonly number[] = [0, 40, 100, 180, 280, 400];

export const LEVEL_TITLES: readonly string[] = [
  'Новичок витрины',
  'Игрок',
  'Знаток',
  'Мастер',
  'Гроссмейстер',
  'Легенда витрины',
];

/** Уровень (1-based) для накопленного XP. */
export function levelFor(xp: number): number {
  const xpSafe = Number.isFinite(xp) && xp > 0 ? xp : 0;
  let level = 1;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (xpSafe >= LEVEL_THRESHOLDS[i]) level = i + 1;
  }
  return level;
}

export function levelTitle(level: number): string {
  // level 1-based, массив 0-based: уровень 1 → LEVEL_TITLES[0].
  return LEVEL_TITLES[Math.min(Math.max(level, 1), LEVEL_TITLES.length) - 1];
}

export interface LevelProgress {
  level: number;
  title: string;
  /** XP до следующего уровня; null — максимум достигнут. */
  xpToNext: number | null;
  /** Доля прогресса к следующему уровню 0..1 (на максимуме — 1). */
  fraction: number;
}

export function levelProgress(xp: number): LevelProgress {
  const level = levelFor(xp);
  const isMax = level >= LEVEL_THRESHOLDS.length;
  if (isMax) return { level, title: levelTitle(level), xpToNext: null, fraction: 1 };
  const from = LEVEL_THRESHOLDS[level - 1];
  const to = LEVEL_THRESHOLDS[level];
  return {
    level,
    title: levelTitle(level),
    xpToNext: to - xp,
    fraction: Math.min(1, Math.max(0, (xp - from) / (to - from))),
  };
}

// ── Достижения ───────────────────────────────────────────────────────────────

export type AchievementId =
  | 'first-steps'
  | 'sharp-eye'
  | 'architect'
  | 'librarian'
  | 'chief-editor'
  | 'all-rounder'
  | 'rising-star';

export interface AchievementDef {
  id: AchievementId;
  emoji: string;
  title: string;
  hint: string;
}

export const ACHIEVEMENT_DEFS: readonly AchievementDef[] = [
  { id: 'first-steps', emoji: '👣', title: 'Первый раунд', hint: 'Завершите любую игру аркады' },
  { id: 'sharp-eye', emoji: '🎯', title: 'Без промаха', hint: 'Викторина — все ответы верно' },
  { id: 'architect', emoji: '🏗️', title: 'Архитектор', hint: 'Соберите слои системы' },
  { id: 'librarian', emoji: '📚', title: 'Библиотекарь', hint: 'Разложите стек без осечек' },
  { id: 'chief-editor', emoji: '🗞️', title: 'Главред', hint: 'Выпустите номер в симуляторе редакции' },
  { id: 'all-rounder', emoji: '🧩', title: 'Универсал', hint: 'Сыграйте во все три игры аркады' },
  { id: 'rising-star', emoji: '⭐', title: 'Подающий надежды', hint: 'Дорастите до уровня «Знаток»' },
];

const ACH_BY_ID = new Map(ACHIEVEMENT_DEFS.map((a) => [a.id, a]));

export function achievementDef(id: AchievementId): AchievementDef | undefined {
  return ACH_BY_ID.get(id);
}

const GAMES_FOR_ALL_ROUNDER: readonly GameId[] = ['quiz', 'layers', 'stack'];

function newlyUnlocked(state: ProgressState, result: GameResult): AchievementId[] {
  const has = (id: AchievementId): boolean => state.achievements.includes(id);
  const out: AchievementId[] = [];
  const totalPlays = Object.values(state.plays).reduce<number>((n, c) => n + (c ?? 0), 0);
  const perfect = result.total > 0 && result.score === result.total;

  if (!has('first-steps') && totalPlays > 0) out.push('first-steps');
  if (!has('sharp-eye') && result.game === 'quiz' && perfect) out.push('sharp-eye');
  if (!has('architect') && result.game === 'layers' && perfect) out.push('architect');
  if (!has('librarian') && result.game === 'stack' && perfect) out.push('librarian');
  if (!has('chief-editor') && result.game === 'sim' && result.score > 0) out.push('chief-editor');
  if (
    !has('all-rounder') &&
    GAMES_FOR_ALL_ROUNDER.every((g) => (state.plays[g] ?? 0) > 0)
  ) {
    out.push('all-rounder');
  }
  if (!has('rising-star') && levelFor(state.xp) >= 3) out.push('rising-star');
  return out;
}

export interface RecordResult {
  /** Новое состояние (старое не мутируется). */
  next: ProgressState;
  gainedXp: number;
  unlocked: AchievementId[];
}

/**
 * Финализирует раунд: начисляет XP, обновляет plays/bests, открывает достижения.
 * Повторный идеальный результат не даёт повторных достижений; XP начисляется всегда.
 */
export function recordResult(prev: ProgressState, result: GameResult): RecordResult {
  const gainedXp = xpFor(result);
  const next: ProgressState = {
    xp: prev.xp + gainedXp,
    plays: { ...prev.plays, [result.game]: (prev.plays[result.game] ?? 0) + 1 },
    bests: {
      ...prev.bests,
      [result.game]: Math.max(prev.bests[result.game] ?? 0, result.score),
    },
    achievements: [...prev.achievements],
  };
  // Достижения оцениваются по уже обновлённому состоянию (plays/xp учтены).
  const unlocked = newlyUnlocked(next, result);
  next.achievements = [...next.achievements, ...unlocked];
  return { next, gainedXp, unlocked };
}
