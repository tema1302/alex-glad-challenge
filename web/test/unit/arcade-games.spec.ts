// Аркада: чистая игровая логика — shuffle/buildQuizDeck/buildStackDeck на данных
// web/data (детерминированный RNG). Плюс целостность данных тренажёра /harness.
import { describe, expect, it } from 'vitest';
import { buildQuizDeck, buildStackDeck, shuffle } from '../../app/components/arcade/game-logic';
import { capabilitySections, stack } from '../../data/showcase';
import { pipelineStages, transitionQuiz } from '../../data/harness-game';

// Детерминированный LCG: одинаковые раунды в тестах.
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return s / 4_294_967_296;
  };
}

describe('shuffle', () => {
  it('сохраняет состав элементов и не мутирует вход', () => {
    const src = ['a', 'b', 'c', 'd', 'e'];
    const out = shuffle(src, lcg(42));
    expect([...out].sort()).toEqual([...src].sort());
    expect(src).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('детерминирован при одном seed и меняется при другом', () => {
    expect(shuffle([1, 2, 3, 4, 5, 6], lcg(7))).toEqual(shuffle([1, 2, 3, 4, 5, 6], lcg(7)));
    const a = JSON.stringify(shuffle([1, 2, 3, 4, 5, 6], lcg(7)));
    const b = JSON.stringify(shuffle([1, 2, 3, 4, 5, 6], lcg(8)));
    expect(a).not.toEqual(b);
  });
});

describe('buildQuizDeck', () => {
  it('раунд: N вопросов, без дублей, каждый с вариантами и верным ответом', () => {
    const deck = buildQuizDeck(capabilitySections, { questions: 8, rng: lcg(1) });
    expect(deck).toHaveLength(8);
    const details = deck.map((q) => q.detail);
    expect(new Set(details).size).toBe(details.length);
    for (const q of deck) {
      expect(q.options).toContain(q.moduleId);
      expect(q.options).toHaveLength(capabilitySections.length);
      expect(new Set(q.options).size).toBe(q.options.length);
      const src = capabilitySections.find((s) => s.id === q.moduleId);
      expect(src?.items.some((it) => it.detail === q.detail)).toBe(true);
    }
  });

  it('round-robin: раунд покрывает разные модули, а не один подряд', () => {
    const deck = buildQuizDeck(capabilitySections, { questions: 6, rng: lcg(3) });
    const modules = new Set(deck.map((q) => q.moduleId));
    expect(modules.size).toBeGreaterThanOrEqual(4);
  });

  it('questions больше общего числа фактов → обрезается до минимума', () => {
    const total = capabilitySections.reduce((n, s) => n + s.items.length, 0);
    const deck = buildQuizDeck(capabilitySections, { questions: 999, rng: lcg(5) });
    expect(deck).toHaveLength(total);
  });
});

describe('buildStackDeck', () => {
  it('пул покрывает все технологии, у каждой верная группа-источник', () => {
    const deck = buildStackDeck(stack, lcg(11));
    const expected = stack.flatMap((g) => g.items);
    expect(deck.map((c) => c.label).sort()).toEqual([...expected].sort());
    for (const c of deck) {
      expect(stack[c.groupId]?.items).toContain(c.label);
      expect(stack[c.groupId]?.name).toBe(c.groupName);
    }
  });
});

describe('данные тренажёра /harness', () => {
  it('пять стадий с уникальными именами, переходы ссылаются на них', () => {
    const names = pipelineStages.map((s) => s.name);
    expect(names).toHaveLength(5);
    expect(new Set(names).size).toBe(5);
    for (const t of transitionQuiz) {
      expect(names).toContain(t.from);
      expect(names).toContain(t.to);
      expect(t.why.length).toBeGreaterThan(0);
    }
    // Инвариант из шаблона 01: возврат Валидация → Реализация разрешён,
    // прыжок Реализация → Подтверждение — нет.
    expect(transitionQuiz.find((t) => t.from === 'Валидация' && t.to === 'Реализация')?.allowed).toBe(true);
    expect(transitionQuiz.find((t) => t.from === 'Реализация' && t.to === 'Подтверждение')?.allowed).toBe(false);
  });
});
