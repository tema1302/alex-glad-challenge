'use client';

// Пазл «Собери архитектуру»: три слоя системы перемешаны — соберите снизу вверх
// (или сверху вниз, как привыкли): порядок проверяется против данных витрины.
// Победа раскрывает состав слоёв (nodes) — это и есть информация страницы.
import { useEffect, useState } from 'react';
import { architectureLayers } from '../../../data/showcase';
import { shuffle } from './game-logic';
import { OrderPuzzle, type PuzzleItem } from './OrderPuzzle';

export function LayersGame() {
  const [firstTry, setFirstTry] = useState<boolean | null>(null);
  // Перемешанный пул строим на клиенте: Math.random на SSR давал бы hydration mismatch.
  const [items, setItems] = useState<PuzzleItem[] | null>(null);

  useEffect(() => {
    setItems(
      shuffle(
        architectureLayers.map((l) => ({
          key: l.name,
          node: (
            <span className="block">
              <span className="block font-mono text-sm text-ink">{l.name}</span>
              <span className="block text-xs text-dim">{l.role}</span>
            </span>
          ),
        })),
      ),
    );
  }, []);

  if (!items) return <p className="text-sm text-dim">Перемешиваем слои…</p>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-dim">
        Разложите слои системы в правильном порядке — клик по карточке кладёт её в стек, повторный клик возвращает.
      </p>
      {firstTry !== null && (
        <p className="font-mono text-xs text-dim">
          прошлый заход: {firstTry ? 'с первой попытки' : 'с возвратами'}
        </p>
      )}
      <OrderPuzzle
        items={items}
        correctKeys={architectureLayers.map((l) => l.name)}
        onSolved={setFirstTry}
        success={
          <div className="space-y-3 rounded-lg border border-line bg-surface-2 p-3">
            {architectureLayers.map((l, i) => (
              <div key={l.name}>
                <div className="font-mono text-sm text-ink">
                  <span className="text-dim">{String(i + 1).padStart(2, '0')}</span> {l.name}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {l.nodes.map((n) => (
                    <span key={n} className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-dim">
                      {n}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        }
      />
    </div>
  );
}
