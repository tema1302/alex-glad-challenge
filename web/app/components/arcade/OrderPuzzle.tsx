'use client';

// OrderPuzzle — общий механик аркадных пазлов «собери порядок»: пул карточек,
// клик → кладём в слоты по номеру, клик по слоту → вернуть в пул. «Проверить»
// активно, когда всё разложено; неверные позиции помечаются, после любой правки
// метки гаснут. Выигрыш = верный порядок; onSolved(false) — были ли возвраты.
import { useId, useState, type ReactNode } from 'react';
import { Button } from '../ui/Button';
import { IconCheck, IconX } from '../ui/icons';

export interface PuzzleItem {
  key: string;
  node: ReactNode;
}

export function OrderPuzzle({
  items,
  correctKeys,
  onSolved,
  success,
}: {
  items: PuzzleItem[];
  /** Верная последовательность key — для проверки по позициям. */
  correctKeys: string[];
  /** Вызывается при верном порядке; аргумент — «собрано без единой ошибки». */
  onSolved?: (firstTry: boolean) => void;
  /** Финальный экран после верного порядка. */
  success: ReactNode;
}) {
  const uid = useId();
  const [placed, setPlaced] = useState<string[]>([]);
  const [wrongAt, setWrongAt] = useState<number[]>([]);
  const [hadMiss, setHadMiss] = useState(false);
  const [solved, setSolved] = useState(false);

  const pool = items.filter((it) => !placed.includes(it.key));
  const byKey = new Map(items.map((it) => [it.key, it]));

  const place = (key: string): void => {
    if (solved || placed.includes(key)) return;
    setPlaced((p) => [...p, key]);
    setWrongAt([]);
  };
  const pull = (idx: number): void => {
    if (solved) return;
    setPlaced((p) => p.filter((_, i) => i !== idx));
    setWrongAt([]);
  };
  const reset = (): void => {
    setPlaced([]);
    setWrongAt([]);
    setSolved(false);
    // hadMiss не сбрасываем между подходами: firstTry честен за весь раунд.
  };
  const check = (): void => {
    const wrong = placed
      .map((k, i) => (k !== correctKeys[i] ? i : -1))
      .filter((i) => i >= 0);
    if (wrong.length === 0) {
      setSolved(true);
      onSolved?.(!hadMiss);
    } else {
      setWrongAt(wrong);
      setHadMiss(true);
    }
  };

  if (solved) {
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm text-ok" role="status">
          <IconCheck className="h-4 w-4" />
          {hadMiss ? 'Порядок собран — со второй попытки тоже считается.' : 'Идеально — ни одной ошибки.'}
        </p>
        {success}
        <Button size="sm" onClick={reset}>
          Ещё раз
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ol className="space-y-2">
        {correctKeys.map((_, i) => {
          const key = placed[i];
          const item = key ? byKey.get(key) : undefined;
          const bad = wrongAt.includes(i);
          return (
            <li key={`${uid}-slot-${i}`}>
              {item ? (
                <button
                  type="button"
                  onClick={() => pull(i)}
                  title="Кликните, чтобы вернуть в пул"
                  className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors duration-fast ease-system focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim ${
                    bad ? 'border-err/60 bg-err/10' : 'border-accent-dim bg-surface-2'
                  }`}
                >
                  <span className="mt-0.5 font-mono text-xs text-accent">{String(i + 1).padStart(2, '0')}</span>
                  <span className="min-w-0 flex-1">{item.node}</span>
                  <span className={`mt-0.5 shrink-0 ${bad ? 'text-err' : 'text-dim'}`}>
                    {bad ? <IconX className="h-4 w-4" /> : <IconCheck className="h-4 w-4" />}
                  </span>
                </button>
              ) : (
                <div
                  aria-hidden="true"
                  className="flex items-center gap-3 rounded-lg border border-dashed border-line p-3 text-dim"
                >
                  <span className="font-mono text-xs">{String(i + 1).padStart(2, '0')}</span>
                  <span className="text-sm">пусто</span>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {wrongAt.length > 0 && (
        <p className="flex items-center gap-2 text-sm text-err" role="alert">
          <IconX className="h-4 w-4" />
          Не тот порядок — красные шаги на своих местах не стоят. Верните и переложите.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {pool.length > 0 ? (
          pool.map((it) => (
            <button
              key={`${uid}-pool-${it.key}`}
              type="button"
              onClick={() => place(it.key)}
              className="rounded-lg border border-line bg-surface p-3 text-left transition-all duration-base ease-system hover:-translate-y-0.5 hover:border-accent-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim"
            >
              {it.node}
            </button>
          ))
        ) : (
          <>
            <Button variant="primary" size="sm" onClick={check}>
              Проверить
            </Button>
            <Button variant="ghost" size="sm" onClick={reset}>
              Сброс
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
