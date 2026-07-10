'use client';

// Переключатель тема dark/light. next-themes даёт хук; монтируем только после
// hydration (иначе SSR/CSR-несоответствие класса темы).
import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <button className="rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700" aria-hidden>
        ···
      </button>
    );
  }
  const isDark = theme === 'dark';
  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="rounded border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
      title="Переключить тему"
    >
      {isDark ? '☀ светлая' : '☾ тёмная'}
    </button>
  );
}
