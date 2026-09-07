// Вращение содержимого пропорционально скроллу (hero-орбиты лендинга).
// rAF-тротлинг, passive-listener, prefers-reduced-motion — статики. 0 deps.
'use client';

import { useEffect, useRef, type ReactNode } from 'react';

export function ScrollSpin({
  children,
  speed = 0.05,
  className = '',
}: {
  children: ReactNode;
  /** Градусов на пиксель скролла. */
  speed?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const apply = (): void => {
      raf = 0;
      if (ref.current) {
        ref.current.style.transform = `rotate(${window.scrollY * speed}deg)`;
      }
    };
    const onScroll = (): void => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    apply();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [speed]);

  return (
    <div ref={ref} aria-hidden="true" className={`will-change-transform ${className}`}>
      {children}
    </div>
  );
}
