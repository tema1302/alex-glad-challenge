'use client';

// RainToggle: тема всегда dark (forcedTheme), кнопка переключает цифровой дождь.
// localStorage 'mx-rain' = 'on'|'off' + dispatch 'mx-rain-change' (MatrixRain слушает).
// mounted-gate — иначе SSR/CSR-несоответствие (читаем localStorage только в браузере).
import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const [rain, setRain] = useState(true);

  useEffect(() => {
    setMounted(true);
    setRain(localStorage.getItem('mx-rain') !== 'off');
  }, []);

  const toggle = () => {
    const next = !rain;
    setRain(next);
    localStorage.setItem('mx-rain', next ? 'on' : 'off');
    window.dispatchEvent(new Event('mx-rain-change'));
  };

  if (!mounted) {
    return (
      <button className="rounded border border-neutral-700 px-2 py-1 text-sm" aria-hidden>
        ···
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      className="rounded border border-neutral-700 px-2 py-1 text-sm text-neutral-300 hover:bg-neutral-900"
      title="Цифровой дождь вкл/выкл"
    >
      {rain ? '◉ ДОЖДЬ' : '◯ ДОЖДЬ'}
    </button>
  );
}
