import type { Config } from 'tailwindcss';

// Дизайн-система 2.0 (ТЗ §5.2): цвета RGB-переменными с alpha (как в 1.0),
// шкала радиусов 4/6/10/full, тени panel/pop, motion-токены 120/200/320ms
// с единым easing, z-шкала nav(20)/dialog(50)/toast(60).
export default {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './data/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        line: 'rgb(var(--border) / <alpha-value>)',
        'line-strong': 'rgb(var(--border-strong) / <alpha-value>)',
        ink: 'rgb(var(--text) / <alpha-value>)',
        dim: 'rgb(var(--dim) / <alpha-value>)',
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          ink: 'rgb(var(--accent-ink) / <alpha-value>)',
          // 40% accent — бордеры/кольца фокуса (не путать с text-dim).
          dim: 'rgb(var(--accent) / 0.4)',
        },
        ok: 'rgb(var(--ok) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        err: 'rgb(var(--err) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'JetBrains Mono', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: {
        sm: '4px',
        DEFAULT: '6px',
        md: '6px',
        lg: '10px',
        full: '9999px',
      },
      boxShadow: {
        panel: '0 1px 0 rgb(0 0 0 / 0.4)',
        pop: '0 8px 32px rgb(0 0 0 / 0.5)',
      },
      transitionDuration: {
        fast: '120ms',
        base: '200ms',
        slow: '320ms',
      },
      transitionTimingFunction: {
        // Единый easing системы — «быстрый старт, мягкая посадка».
        system: 'cubic-bezier(.2,.8,.2,1)',
      },
      zIndex: {
        nav: '20',
        dialog: '50',
        toast: '60',
      },
    },
  },
  plugins: [],
} satisfies Config;
