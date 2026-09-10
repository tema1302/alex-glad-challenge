'use client';

// Викторина «Угадай модуль»: показываем факт из витрины — игрок выбирает,
// какой системе он принадлежит. Ответ раскрывает полный факт (название +
// описание), так игра и учит. Рекорд раунда хранится в localStorage.
import { useCallback, useEffect, useState } from 'react';
import { capabilitySections } from '../../../data/showcase';
import { buildQuizDeck, type QuizQuestion } from './game-logic';
import { Button } from '../ui/Button';
import { IconCheck, IconX } from '../ui/icons';

const DECK_SIZE = 8;
const BEST_KEY = 'arcade.quiz.best';

const SECTION_BY_ID = new Map(capabilitySections.map((s) => [s.id, s]));

function readBest(): number {
  try {
    return Number(window.localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeBest(v: number): void {
  try {
    window.localStorage.setItem(BEST_KEY, String(v));
  } catch {
    /* приватный режим — рекорд просто не сохранится */
  }
}

export function QuizGame() {
  // Колода с Math.random строится только на клиенте: SSR и гидрация получили бы
  // разные карты → hydration mismatch.
  const [deck, setDeck] = useState<QuizQuestion[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState<number | null>(null);

  useEffect(() => {
    setDeck(buildQuizDeck(capabilitySections, { questions: DECK_SIZE }));
  }, []);

  const q = deck?.[idx];
  const answered = picked !== null;
  const correct = answered && q !== undefined && picked === q.moduleId;

  const answer = useCallback(
    (id: string): void => {
      if (answered || !q) return;
      setPicked(id);
      if (id === q.moduleId) setScore((s) => s + 1);
    },
    [answered, q],
  );

  const next = useCallback((): void => {
    if (!deck) return;
    if (idx + 1 < deck.length) {
      setIdx(idx + 1);
      setPicked(null);
      return;
    }
    const finalBest = Math.max(score, readBest());
    writeBest(finalBest);
    setBest(finalBest);
  }, [idx, deck, score]);

  const restart = useCallback((): void => {
    setDeck(buildQuizDeck(capabilitySections, { questions: DECK_SIZE }));
    setIdx(0);
    setPicked(null);
    setScore(0);
    setBest(null);
  }, []);

  if (!deck || !q) return <p className="text-sm text-dim">Перемешиваем вопросы…</p>;

  if (best !== null) {
    const verdict =
      score === deck.length
        ? 'Все восемь — вы знаете систему вдоль и поперёк.'
        : score >= deck.length - 2
          ? 'Почти в десятку — факты витрины теперь ваши.'
          : 'Нормальный заход: листайте витрину ниже и пробуйте снова.';
    return (
      <div className="space-y-4">
        <p className="text-3xl font-semibold text-ink" role="status">
          {score}/{deck.length}
        </p>
        <p className="text-sm text-dim">{verdict}</p>
        <p className="font-mono text-xs text-dim">рекорд: {best}</p>
        <Button variant="primary" size="sm" onClick={restart}>
          Ещё раунд
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between font-mono text-xs text-dim">
        <span>
          вопрос {idx + 1}/{deck.length}
        </span>
        <span>
          верно: {score} {score > 0 && <span aria-hidden>· ✓</span>}
        </span>
      </div>

      <p className="max-w-2xl text-sm leading-relaxed text-ink">«{q.detail}»</p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {q.options.map((id) => {
          const mod = SECTION_BY_ID.get(id);
          if (!mod) return null;
          const isRight = id === q.moduleId;
          const state = !answered
            ? 'idle'
            : isRight
              ? 'right'
              : id === picked
                ? 'wrong'
                : 'muted';
          const cls =
            state === 'idle'
              ? 'border-line bg-surface hover:-translate-y-0.5 hover:border-accent-dim text-ink'
              : state === 'right'
                ? 'border-ok/60 bg-ok/10 text-ink'
                : state === 'wrong'
                  ? 'border-err/60 bg-err/10 text-ink'
                  : 'border-line text-dim';
          return (
            <button
              key={id}
              type="button"
              onClick={() => answer(id)}
              disabled={answered}
              className={`flex min-h-[44px] items-center gap-2 rounded-lg border p-3 text-left text-sm transition-all duration-base ease-system focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim ${cls}`}
            >
              <span aria-hidden="true">{mod.icon}</span>
              <span className="min-w-0 flex-1 font-medium">{mod.title}</span>
              {state === 'right' && <IconCheck className="h-4 w-4 shrink-0 text-ok" />}
              {state === 'wrong' && <IconX className="h-4 w-4 shrink-0 text-err" />}
            </button>
          );
        })}
      </div>

      <div aria-live="polite" className="min-h-[3.5rem]">
        {answered && (
          <div className="space-y-3">
            <p className={`text-sm ${correct ? 'text-ok' : 'text-err'}`}>
              {correct ? (
                <>
                  <IconCheck className="mr-1 inline h-4 w-4 align-[-2px]" />
                  Верно — это «{q.itemTitle}», модуль {q.moduleTitle}.
                </>
              ) : (
                <>
                  <IconX className="mr-1 inline h-4 w-4 align-[-2px]" />
                  Это «{q.itemTitle}» — модуль {q.moduleTitle}.
                </>
              )}
            </p>
            <Button variant="primary" size="sm" onClick={next}>
              {idx + 1 < deck.length ? 'Дальше' : 'Итог'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
