'use client';

// Тренажёр харнеса: фаза 1 — соберите пайплайн из пяти стадий (OrderPuzzle),
// фаза 2 — три перехода по графу: «можно» или «нельзя»? Факты — из шаблона 01.
import { useState } from 'react';
import { pipelineStages, transitionQuiz, type TransitionRule } from '../../data/harness-game';
import { OrderPuzzle, type PuzzleItem } from '../components/arcade/OrderPuzzle';
import { Button } from '../components/ui/Button';
import { IconCheck, IconX } from '../components/ui/icons';

export function PipelineGame() {
  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState<'order' | 'transitions' | 'done'>('order');
  const [qIdx, setQIdx] = useState(0);
  const [answered, setAnswered] = useState<null | boolean>(null); // верно ли отвечено
  const [score, setScore] = useState(0);

  const items: PuzzleItem[] = pipelineStages.map((s) => ({
    key: s.name,
    node: (
      <span className="block">
        <span className="block font-mono text-sm text-ink">{s.name}</span>
        <span className="block text-xs text-dim">{s.hint}</span>
      </span>
    ),
  }));

  const restart = (): void => {
    setRound((r) => r + 1);
    setPhase('order');
    setQIdx(0);
    setAnswered(null);
    setScore(0);
  };

  const q: TransitionRule = transitionQuiz[qIdx];
  // Фиксированный порядок кнопок: пересорбовка на каждый рендер дёргала бы UI после ответа.
  const options = [
    { label: 'Можно', value: true },
    { label: 'Нельзя', value: false },
  ];

  if (phase === 'done') {
    return (
      <div className="space-y-4">
        <p className="text-3xl font-semibold text-ink" role="status">
          {score}/{transitionQuiz.length}
        </p>
        <p className="text-sm text-dim">
          {score === transitionQuiz.length
            ? 'Граф переходов вы чувствуете — харнес вам по плечу.'
            : 'Пайплайн собран. Загляните в шаблон 01 выше — граф там нарисован явно.'}
        </p>
        <Button variant="primary" size="sm" onClick={restart}>
          Ещё раз
        </Button>
      </div>
    );
  }

  if (phase === 'transitions') {
    const answer = (allowed: boolean): void => {
      if (answered !== null) return;
      setAnswered(allowed === q.allowed);
      if (allowed === q.allowed) setScore((s) => s + 1);
    };
    const next = (): void => {
      if (qIdx + 1 < transitionQuiz.length) {
        setQIdx(qIdx + 1);
        setAnswered(null);
      } else {
        setPhase('done');
      }
    };
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between font-mono text-xs text-dim">
          <span>
            переход {qIdx + 1}/{transitionQuiz.length}
          </span>
          <span>верно: {score}</span>
        </div>
        <p className="text-sm text-ink">
          Переход «{q.from} → {q.to}» — так можно?
        </p>
        <div className="flex gap-2">
          {options.map((o) => {
            const state = answered === null ? 'idle' : o.value === q.allowed ? 'right' : 'wrong';
            const cls =
              state === 'idle'
                ? 'border-line bg-surface text-ink hover:-translate-y-0.5 hover:border-accent-dim'
                : state === 'right'
                  ? 'border-ok/60 bg-ok/10 text-ink'
                  : 'border-err/60 bg-err/10 text-ink';
            return (
              <button
                key={o.label}
                type="button"
                onClick={() => answer(o.value)}
                disabled={answered !== null}
                className={`inline-flex min-h-[44px] items-center gap-2 rounded-lg border px-4 text-sm transition-all duration-base ease-system focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim ${cls}`}
              >
                {state === 'right' && <IconCheck className="h-4 w-4 text-ok" />}
                {state === 'wrong' && <IconX className="h-4 w-4 text-err" />}
                {o.label}
              </button>
            );
          })}
        </div>
        <div aria-live="polite" className="min-h-[3.5rem] space-y-3">
          {answered !== null && (
            <>
              <p className={`text-sm ${answered ? 'text-ok' : 'text-err'}`}>{q.why}</p>
              <Button variant="primary" size="sm" onClick={next}>
                {qIdx + 1 < transitionQuiz.length ? 'Дальше' : 'Итог'}
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div key={round} className="space-y-3">
      <p className="text-sm text-dim">
        Пять стадий перемешаны. Разложите их по порядку выполнения — как в шаблоне 01.
      </p>
      <OrderPuzzle
        items={items}
        correctKeys={pipelineStages.map((s) => s.name)}
        onSolved={() => setPhase('transitions')}
        success={
          <p className="text-sm text-dim">
            Пайплайн собран. Теперь проверьте граф переходов — не каждый шаг между стадиями разрешён.
          </p>
        }
      />
    </div>
  );
}
