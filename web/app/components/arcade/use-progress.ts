'use client';

// Персистентный прогресс аркады: localStorage как единственное хранилище
// (счётчики игрока не секрет и не стоят бэкенда). Чтение валидирует форму
// состояния: мусор/чужие данные откатываются к пустому прогрессу, а не роняют
// страницу (паттерн readBest из QuizGame). reportResult — единственная точка
// записи:/load → recordResult → save → CustomEvent для живых подписчиков.
import { useEffect, useState } from 'react';
import {
  EMPTY_PROGRESS,
  recordResult,
  ACHIEVEMENT_DEFS,
  type AchievementId,
  type GameId,
  type GameResult,
  type ProgressState,
} from './progress';

const STORAGE_KEY = 'arcade.progress.v1';
export const PROGRESS_EVENT = 'arcade:progress';

const GAME_IDS: readonly GameId[] = ['quiz', 'layers', 'stack', 'sim'];
const ACH_IDS = new Set(ACHIEVEMENT_DEFS.map((a) => a.id));

function toFiniteInt(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/** Читает прогресс из localStorage; любая порча → пустой прогресс без выброса. */
export function loadProgress(): ProgressState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_PROGRESS;
    const parsed = JSON.parse(raw) as Partial<ProgressState> | null;
    if (!parsed || typeof parsed !== 'object') return EMPTY_PROGRESS;

    const plays: ProgressState['plays'] = {};
    if (parsed.plays && typeof parsed.plays === 'object') {
      for (const g of GAME_IDS) {
        const n = (parsed.plays as Record<string, unknown>)[g];
        if (n !== undefined) plays[g] = toFiniteInt(n);
      }
    }
    const bests: ProgressState['bests'] = {};
    if (parsed.bests && typeof parsed.bests === 'object') {
      for (const g of GAME_IDS) {
        const n = (parsed.bests as Record<string, unknown>)[g];
        if (n !== undefined) bests[g] = toFiniteInt(n);
      }
    }
    const achievements = Array.isArray(parsed.achievements)
      ? parsed.achievements.filter(
        (id): id is AchievementId => typeof id === 'string' && ACH_IDS.has(id as AchievementId),
      )
      : [];
    return {
      xp: toFiniteInt(parsed.xp),
      plays,
      bests,
      achievements: [...new Set(achievements)],
    };
  } catch {
    // приватный режим/битый JSON — играем без прогресса, не роняя страницу
    return EMPTY_PROGRESS;
  }
}

export function saveProgress(state: ProgressState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* приватный режим — прогресс просто не сохранится между сессиями */
  }
}

export interface ReportOutcome {
  gainedXp: number;
  unlocked: AchievementId[];
}

/** Финализирует раунд: считает, пишет в storage и оповещает подписанных. */
export function reportResult(result: GameResult): ReportOutcome {
  const { next, gainedXp, unlocked } = recordResult(loadProgress(), result);
  saveProgress(next);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<ProgressState>(PROGRESS_EVENT, { detail: next }));
  }
  return { gainedXp, unlocked };
}

/** Живое состояние прогресса: старт + подписка на события reportResult. */
export function useProgress(): ProgressState {
  const [state, setState] = useState<ProgressState>(EMPTY_PROGRESS);

  useEffect(() => {
    setState(loadProgress());
    const onChange = (e: Event): void => {
      const detail = (e as CustomEvent<ProgressState>).detail;
      setState(detail ?? loadProgress());
    };
    window.addEventListener(PROGRESS_EVENT, onChange);
    // Синхронизация между вкладками — приятный бонус, не требование.
    const onStorage = (e: StorageEvent): void => {
      if (e.key === STORAGE_KEY) setState(loadProgress());
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(PROGRESS_EVENT, onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return state;
}
