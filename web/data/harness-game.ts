// Игровые данные тренажёра /harness: пять стадий пайплайна и правила графа
// переходов. Источник фактов — шаблон 01 «Харнес внутри Claude Code»
// (web/data/harness.ts, секции «Пайплайн» и «Граф переходов»).
// Только данные, без Tailwind-классов.

export interface PipelineStage {
  n: string;
  name: string;
  hint: string;
}

export const pipelineStages: PipelineStage[] = [
  { n: '1', name: 'Изучение', hint: 'консилиум исследует задачу и пишет сводку' },
  { n: '2', name: 'Планирование', hint: 'планер превращает сводку в план' },
  { n: '3', name: 'Реализация', hint: 'исполнитель правит код по плану, typecheck зелёный' },
  { n: '4', name: 'Валидация', hint: 'ревьюер перечитывает артефакты и гоняет проверки' },
  { n: '5', name: 'Подтверждение', hint: 'финальный отчёт и приёмка человеком' },
];

export interface TransitionRule {
  from: string;
  to: string;
  allowed: boolean;
  why: string;
}

export const transitionQuiz: TransitionRule[] = [
  {
    from: 'Валидация',
    to: 'Реализация',
    allowed: true,
    why: 'единственный разрешённый возврат — чинить код и снова на проверку (не больше 2 за цикл).',
  },
  {
    from: 'Реализация',
    to: 'Подтверждение',
    allowed: false,
    why: 'запрещено: в приёмку нельзя попасть мимо Валидации.',
  },
  {
    from: 'Изучение',
    to: 'Валидация',
    allowed: false,
    why: 'прыжок через стадию — граф переходов его не пропускает.',
  },
];
