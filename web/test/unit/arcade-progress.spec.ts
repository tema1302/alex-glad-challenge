// Движок прогресса аркады: XP-формула, уровни, достижения, иммутабельность.
import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENT_DEFS,
  EMPTY_PROGRESS,
  LEVEL_THRESHOLDS,
  LEVEL_TITLES,
  levelFor,
  levelProgress,
  levelTitle,
  recordResult,
  xpFor,
  type GameResult,
  type ProgressState,
} from '../../app/components/arcade/progress';

function state(patch: Partial<ProgressState>): ProgressState {
  return { ...EMPTY_PROGRESS, ...patch };
}

function run(prev: ProgressState, result: GameResult) {
  return recordResult(prev, result);
}

describe('xpFor — начисление XP', () => {
  it('идеальный раунд даёт полный базовый XP игры', () => {
    expect(xpFor({ game: 'quiz', score: 8, total: 8 })).toBe(40);
    expect(xpFor({ game: 'stack', score: 17, total: 17 })).toBe(30);
    expect(xpFor({ game: 'layers', score: 1, total: 1 })).toBe(20);
    expect(xpFor({ game: 'sim', score: 1, total: 1 })).toBe(25);
  });

  it('частичный раунд — XP пропорционально доле и округляется', () => {
    expect(xpFor({ game: 'quiz', score: 4, total: 8 })).toBe(20);
    expect(xpFor({ game: 'quiz', score: 1, total: 3 })).toBe(13); // 40/3 = 13.33 → 13
  });

  it('бонусXP прибавляется сверх формулы', () => {
    expect(xpFor({ game: 'layers', score: 1, total: 1, bonusXp: 5 })).toBe(25);
    expect(xpFor({ game: 'layers', score: 1, total: 1, bonusXp: 0 })).toBe(20);
    expect(xpFor({ game: 'layers', score: 1, total: 1, bonusXp: -7 })).toBe(20); // мусор → 0
  });

  it('edge: нулевые и отрицательные значения не ломают формулу', () => {
    expect(xpFor({ game: 'quiz', score: 0, total: 8 })).toBe(0);
    expect(xpFor({ game: 'quiz', score: -3, total: 8 })).toBe(0);
    expect(xpFor({ game: 'quiz', score: 99, total: 8 })).toBe(40); // score клампится к total
    expect(xpFor({ game: 'quiz', score: 1, total: 0 })).toBe(0); // деление на ноль
  });
});

describe('уровни', () => {
  it('пороги монотонны, заголовков столько же, сколько порогов', () => {
    for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
      expect(LEVEL_THRESHOLDS[i]).toBeGreaterThan(LEVEL_THRESHOLDS[i - 1]);
    }
    expect(LEVEL_TITLES).toHaveLength(LEVEL_THRESHOLDS.length);
  });

  it('levelFor: 0 XP — уровень 1, порог открывает уровень, мусор → 1', () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(39)).toBe(1);
    expect(levelFor(40)).toBe(2);
    expect(levelFor(LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1])).toBe(LEVEL_THRESHOLDS.length);
    expect(levelFor(10_000)).toBe(LEVEL_THRESHOLDS.length); // выше максимума — не растёт
    expect(levelFor(Number.NaN)).toBe(1);
    expect(levelFor(-5)).toBe(1);
  });

  it('levelProgress: до следующего уровня и доля 0..1', () => {
    const mid = levelProgress(70); // между 40 и 100
    expect(mid.level).toBe(2);
    expect(mid.xpToNext).toBe(30);
    expect(mid.fraction).toBeCloseTo(0.5, 5);

    const max = levelProgress(999_999);
    expect(max.xpToNext).toBeNull();
    expect(max.fraction).toBe(1);
  });

  it('levelTitle безопасен вне диапазона', () => {
    expect(levelTitle(1)).toBe(LEVEL_TITLES[0]);
    expect(levelTitle(99)).toBe(LEVEL_TITLES[LEVEL_TITLES.length - 1]);
    expect(levelTitle(0)).toBe(LEVEL_TITLES[0]);
    expect(levelTitle(-1)).toBe(LEVEL_TITLES[0]);
  });
});

describe('recordResult — счёт, рекорды, достижения', () => {
  it('начисляет XP, растит plays и обновляет best по максимуму', () => {
    const prev = state({ xp: 10, plays: { quiz: 2 }, bests: { quiz: 5 } });
    const { next, gainedXp } = run(prev, { game: 'quiz', score: 7, total: 8 });
    expect(gainedXp).toBe(35);
    expect(next.xp).toBe(45);
    expect(next.plays.quiz).toBe(3);
    expect(next.bests.quiz).toBe(7);
  });

  it('иммутабельно: вход не мутируется', () => {
    const prev = state({ xp: 5, plays: { quiz: 1 }, bests: { quiz: 2 }, achievements: [] });
    const snapshot = JSON.parse(JSON.stringify(prev));
    run(prev, { game: 'quiz', score: 8, total: 8 });
    expect(prev).toEqual(snapshot);
  });

  it('первый завершённый раунд открывает «Первый раунд»', () => {
    const { next, unlocked } = run(EMPTY_PROGRESS, { game: 'sim', score: 1, total: 1 });
    expect(unlocked).toContain('first-steps');
    expect(next.achievements).toContain('first-steps');
  });

  it('идеальная викторина открывает «Без промаха», неидеальная — нет', () => {
    const perfect = run(EMPTY_PROGRESS, { game: 'quiz', score: 8, total: 8 });
    expect(perfect.unlocked).toContain('sharp-eye');

    const imperfect = run(EMPTY_PROGRESS, { game: 'quiz', score: 7, total: 8 });
    expect(imperfect.unlocked).not.toContain('sharp-eye');
  });

  it('«Библиотекарь» — только стек без осечек; «Архитектор» — решённый пазл', () => {
    const botched = run(EMPTY_PROGRESS, { game: 'stack', score: 15, total: 17 });
    expect(botched.unlocked).not.toContain('librarian');

    const clean = run(EMPTY_PROGRESS, { game: 'stack', score: 17, total: 17 });
    expect(clean.unlocked).toContain('librarian');

    const layers = run(EMPTY_PROGRESS, { game: 'layers', score: 1, total: 1 });
    expect(layers.unlocked).toContain('architect');
  });

  it('«Главред» — за выпуск в симуляторе', () => {
    const { unlocked } = run(EMPTY_PROGRESS, { game: 'sim', score: 1, total: 1 });
    expect(unlocked).toContain('chief-editor');
  });

  it('«Универсал» — только после всех трёх игр аркады (симулятор не считается)', () => {
    let s = EMPTY_PROGRESS;
    s = run(s, { game: 'quiz', score: 4, total: 8 }).next;
    s = run(s, { game: 'stack', score: 10, total: 17 }).next;
    const before = run(s, { game: 'sim', score: 1, total: 1 });
    expect(before.unlocked).not.toContain('all-rounder');

    const after = run(before.next, { game: 'layers', score: 1, total: 1 });
    expect(after.unlocked).toContain('all-rounder');
  });

  it('«Подающий надежды» — по достижении уровня «Знаток»', () => {
    // Два идеальных квиза = 80 XP → уровень 2 (< 100). Третий идеальный = 120 → уровень 3.
    let s = EMPTY_PROGRESS;
    s = run(s, { game: 'quiz', score: 8, total: 8 }).next;
    s = run(s, { game: 'quiz', score: 8, total: 8 }).next;
    expect(levelFor(s.xp)).toBe(2);
    const third = run(s, { game: 'quiz', score: 8, total: 8 });
    expect(levelFor(third.next.xp)).toBeGreaterThanOrEqual(3);
    expect(third.unlocked).toContain('rising-star');
  });

  it('достижение не открывается повторно', () => {
    const first = run(EMPTY_PROGRESS, { game: 'quiz', score: 8, total: 8 });
    expect(first.unlocked).toContain('sharp-eye');
    const second = run(first.next, { game: 'quiz', score: 8, total: 8 });
    expect(second.unlocked).not.toContain('sharp-eye');
    expect(second.next.achievements.filter((a) => a === 'sharp-eye')).toHaveLength(1);
  });

  it('XP начисляется каждый раунд, даже когда достижения уже открыты', () => {
    const first = run(EMPTY_PROGRESS, { game: 'quiz', score: 8, total: 8 });
    const second = run(first.next, { game: 'quiz', score: 8, total: 8 });
    expect(second.gainedXp).toBe(40);
    expect(second.next.xp).toBe(80);
    expect(second.unlocked).toHaveLength(0);
  });

  it('каталог достижений: уникальные id, непустые заголовки и подсказки', () => {
    const ids = ACHIEVEMENT_DEFS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of ACHIEVEMENT_DEFS) {
      expect(a.title.length).toBeGreaterThan(0);
      expect(a.hint.length).toBeGreaterThan(0);
      expect(a.emoji.length).toBeGreaterThan(0);
    }
  });
});
