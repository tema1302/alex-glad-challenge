// Shared отбивка ожидания для pre-first-token фазы: карусель IT-фактов (8с/факт) +
// честный elapsed-таймер «ждём Nс» (НЕ ETA-предсказание — local-4B cold/warm разброс
// делает любое «осталось» ложью). Self-contained: сам крутит интервалы, сам считает
// elapsed от mount. Lifecycle = mount/unmount родителя (mount на send, unmount на
// первом токене / running=false / error).
//
// 'use client' — useEffect/useRef/useState. SSR-safe: useState(0) детерминирован →
// server/client рендерят IT_FACTS[0] + elapsed=0 одинаково (hydration mismatch нет).
// aria-hidden на обе строки: родитель role="log" aria-live уже работает; доп. live-роль
// была бы double-announce, а elapsed тикает каждую секунду (R9).
'use client';

import { useEffect, useRef, useState } from 'react';
import { IT_FACTS } from '../../lib/shared/it-facts';

const FACT_INTERVAL_MS = 8000; // фикс п.4: было magic-number 3000 в локальном FactLoader.
const ELAPSED_TICK_MS = 1000;

export function FactLoader() {
  const [idx, setIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const t0 = useRef(Date.now()); // монотонный старт = mount (≈ момент send в родителе).

  useEffect(() => {
    if (IT_FACTS.length === 0) return;
    const carousel = setInterval(
      () => setIdx((i) => (i + 1) % IT_FACTS.length),
      FACT_INTERVAL_MS,
    );
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - t0.current) / 1000)),
      ELAPSED_TICK_MS,
    );
    return () => {
      clearInterval(carousel);
      clearInterval(timer);
    };
  }, []);

  if (IT_FACTS.length === 0) {
    return <p className="text-sm text-dim">Думаю…</p>;
  }
  return (
    <div>
      <p className="font-mono text-xs uppercase text-dim" aria-hidden="true">
        Думаю · ждём {elapsed}с
      </p>
      <p key={idx} className="fact-fade" aria-hidden="true">
        {IT_FACTS[idx]}
      </p>
    </div>
  );
}
