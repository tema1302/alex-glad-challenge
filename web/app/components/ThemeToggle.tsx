// Переключатель тёмной/светлой темы (next-themes, class-атрибут на html).
// До гидратации — нейтральный квадрат (размер зафиксирован, без layout-shift).
'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { IconMoon, IconSun } from './ui/icons';

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === 'dark';
  const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim';

  return (
    <button
      type="button"
      aria-label={mounted ? (isDark ? 'Включить светлую тему' : 'Включить тёмную тему') : 'Переключить тему'}
      title="Тема"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-dim transition-colors duration-fast hover:text-ink ${FOCUS} ${className}`}
    >
      {mounted ? (
        isDark ? (
          <IconSun />
        ) : (
          <IconMoon />
        )
      ) : (
        <span className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}
