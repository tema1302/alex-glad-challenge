'use client';

// Сортировка «Разложи стек»: карточки технологий из витрины — раскладываете
// по двум корзинам (ядро / web). Выбор карточки → клик по корзине. Ошибка
// возвращает карточку и честно говорит, где она живёт: так и запоминается.
// Итог считается по карточкам, которые легли без единой осечки.
import { useCallback, useEffect, useState } from 'react';
import { stack } from '../../../data/showcase';
import { buildStackDeck, type StackCard } from './game-logic';
import { Button } from '../ui/Button';
import { IconX } from '../ui/icons';

export function StackGame() {
  const [round, setRound] = useState(0);
  // Колода с Math.random — только на клиенте (SSR дал бы hydration mismatch).
  const [deck, setDeck] = useState<StackCard[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null); // индекс в deck
  const [botched, setBotched] = useState<string[]>([]); // метки осечённых карточек
  const [miss, setMiss] = useState<string | null>(null); // текст последней ошибки
  const [done, setDone] = useState(false);

  const deal = useCallback((): void => {
    setDeck(buildStackDeck(stack));
    setSelected(null);
    setBotched([]);
    setMiss(null);
    setDone(false);
    setRound((r) => r + 1);
  }, []);

  useEffect(() => {
    deal();
  }, [deal]);

  const remaining = (deck ?? []).filter((c) => c.groupId !== -1);
  const total = deck?.length ?? 0;
  const placedCount = total - remaining.length;
  const cleanCount = placedCount - botched.length;

  const place = useCallback(
    (groupId: number): void => {
      if (selected === null || done || !deck) return;
      const card = deck[selected];
      if (card.groupId === groupId) {
        setDeck((d) => (d ?? []).map((c, i) => (i === selected ? { ...c, groupId: -1 } : c)));
        setMiss(null);
      } else {
        const home = stack[card.groupId]?.name ?? 'не тут';
        setMiss(`«${card.label}» живёт в «${home}» — попробуйте туда.`);
        setBotched((b) => (b.includes(card.label) ? b : [...b, card.label]));
      }
      setSelected(null);
    },
    [selected, deck, done],
  );

  const restart = deal;

  if (!deck) return <p className="text-sm text-dim">Перемешиваем карточки…</p>;

  if (done) {
    return (
      <div className="space-y-4">
        <p className="text-3xl font-semibold text-ink" role="status">
          {cleanCount}/{total}
        </p>
        <p className="text-sm text-dim">
          {cleanCount === total ? 'Ни одной осечки — стек разложен идеально.' : 'Разложено. Осечки — тоже способ запомнить.'}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {stack.map((g) => (
            <div key={g.name} className="rounded-lg border border-line bg-surface-2 p-3">
              <div className="font-mono text-xs uppercase tracking-wider text-dim">{g.name}</div>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {g.items.map((it) => (
                  <li key={it} className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-dim">
                    {it}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <Button variant="primary" size="sm" onClick={restart}>
          Ещё раз
        </Button>
      </div>
    );
  }

  return (
    <div key={round} className="space-y-4">
      <p className="text-sm text-dim">Выберите карточку технологии, затем кликните корзину, где она живёт.</p>
      <div className="flex items-center justify-between font-mono text-xs text-dim">
        <span>
          осталось: {remaining.length}/{total}
        </span>
        <span>без осечек: {cleanCount}</span>
      </div>

      {miss && (
        <p className="flex items-center gap-2 text-sm text-err" role="alert">
          <IconX className="h-4 w-4 shrink-0" />
          {miss}
        </p>
      )}

      {/* Пул карточек: выбранная подсвечена акцентом */}
      <ul className="flex flex-wrap gap-1.5">
        {deck.map((c, i) =>
          c.groupId !== -1 ? (
            <li key={`${round}-${c.label}`}>
              <button
                type="button"
                onClick={() => setSelected(i)}
                aria-pressed={selected === i}
                className={`min-h-[36px] rounded-md border px-2.5 py-1 font-mono text-xs transition-all duration-base ease-system focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim ${
                  selected === i
                    ? 'border-accent bg-accent/15 text-ink'
                    : 'border-line bg-surface text-dim hover:-translate-y-0.5 hover:border-accent-dim hover:text-ink'
                }`}
              >
                {c.label}
              </button>
            </li>
          ) : null,
        )}
      </ul>

      <div className="grid gap-3 sm:grid-cols-2">
        {stack.map((g, gi) => (
          <button
            key={g.name}
            type="button"
            onClick={() => place(gi)}
            disabled={selected === null}
            className={`rounded-lg border p-3 text-left transition-all duration-base ease-system focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim ${
              selected === null
                ? 'cursor-default border-line bg-surface'
                : 'cursor-pointer border-dashed border-accent-dim bg-surface-2 hover:border-accent hover:bg-accent/10'
            }`}
          >
            <div className="font-mono text-xs uppercase tracking-wider text-dim">{g.name}</div>
            <p className="mt-1 text-xs text-dim">{selected === null ? 'выберите карточку выше' : 'сюда'}</p>
          </button>
        ))}
      </div>

      {remaining.length === 0 && (
        <Button variant="primary" size="sm" onClick={() => setDone(true)}>
          Итог
        </Button>
      )}
    </div>
  );
}
