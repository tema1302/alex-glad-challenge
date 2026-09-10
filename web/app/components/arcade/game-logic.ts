// Чистая игровая логика аркады (без React и без 'use client'): перемешивание и
// сборка колод из данных витрины (web/data/showcase.ts). RNG инъектится —
// детерминированные юнит-тесты и одинаковые раунды в тестах UI.

export type Rng = () => number;

// Fisher–Yates; возвращает новую копию, вход не мутируется.
export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ── Викторина «Угадай модуль» ────────────────────────────────────────────────

export interface QuizSectionInput {
  id: string;
  title: string;
  icon: string;
  items: ReadonlyArray<{ title: string; detail: string }>;
}

export interface QuizQuestion {
  moduleId: string;
  moduleTitle: string;
  icon: string;
  itemTitle: string;
  detail: string;
  /** id модулей-вариантов, перемешан; всегда содержит верный moduleId. */
  options: string[];
}

// Колода без повторов: секции перемешиваются, вопросы идут по кругу
// (по одному item из каждой), поэтому раунд покрывает разные модули, а не подряд.
// @example buildQuizDeck(capabilitySections, { questions: 8, rng: lcg(42) })
//   → 8 вопросов по всем секциям; q.options — все id модулей вперемешку,
//     верный moduleId среди них гарантирован.
export function buildQuizDeck(
  sections: readonly QuizSectionInput[],
  opts: { questions?: number; rng?: Rng } = {},
): QuizQuestion[] {
  const rng = opts.rng ?? Math.random;
  const want = Math.min(opts.questions ?? 8, sections.reduce((n, s) => n + s.items.length, 0));
  const queues = shuffle(
    shuffle(sections, rng).map((s) => [...s.items.map((it) => ({ s, it }))]),
    rng,
  );
  const picked: { s: QuizSectionInput; it: { title: string; detail: string } }[] = [];
  let progress = true;
  while (picked.length < want && progress) {
    progress = false;
    for (const q of queues) {
      const next = q.shift();
      if (next) {
        picked.push(next);
        progress = true;
        if (picked.length >= want) break;
      }
    }
  }
  return picked.map(({ s, it }) => ({
    moduleId: s.id,
    moduleTitle: s.title,
    icon: s.icon,
    itemTitle: it.title,
    detail: it.detail,
    options: shuffle(sections.map((x) => x.id), rng),
  }));
}

// ── Сортировка «Разложи стек» ────────────────────────────────────────────────

export interface StackGroupInput {
  name: string;
  items: readonly string[];
}

export interface StackCard {
  label: string;
  groupId: number;
  groupName: string;
}

export function buildStackDeck(groups: readonly StackGroupInput[], rng: Rng = Math.random): StackCard[] {
  return shuffle(
    groups.flatMap((g, groupId) => g.items.map((label) => ({ label, groupId, groupName: g.name }))),
    rng,
  );
}
