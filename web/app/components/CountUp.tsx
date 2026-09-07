// Count-up цифр proof-бенда при появлении в вьюпорте (IntersectionObserver +
// rAF, ease-out cubic). Не числа (суффикс «+», «₽») сохраняются как есть.
// reduced-motion → значение показывается сразу. 0 deps.
'use client';

import { useEffect, useRef, useState } from 'react';

export function CountUp({ value, className = '' }: { value: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState<string>('0');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const num = Number.parseInt(value, 10);
    if (!Number.isFinite(num)) {
      setDisplay(value);
      return;
    }
    const suffix = value.slice(String(num).length);

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(value);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        const t0 = performance.now();
        const duration = 1100;
        const tick = (t: number): void => {
          const p = Math.min((t - t0) / duration, 1);
          const eased = 1 - Math.pow(1 - p, 3);
          setDisplay(`${Math.round(num * eased)}${suffix}`);
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [value]);

  return (
    <span ref={ref} className={`tabular-nums ${className}`}>
      {display}
    </span>
  );
}
