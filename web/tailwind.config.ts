import type { Config } from 'tailwindcss';

// Дизайн-система 2.0 (ТЗ §5.2): цвета RGB-переменными с alpha (тёмная админка),
// шкала радиусов 4/6/10/14/full, тени panel/pop/lift на CSS-переменных темы,
// motion-токены 120/200/320ms с единым easing, z-шкала nav(20)/dialog(50)/toast(60).
// Палитра `paper`/`brand` — световый мир лендинга (Paper × Aurora), изолирован
// классом .lp на корне страницы и не смешивается с админ-токенами.
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
        // --- Лендинг: палитра на CSS-переменных, следует за темой (html.dark/light) ---
        paper: 'rgb(var(--lp-bg) / <alpha-value>)',
        'paper-2': 'rgb(var(--lp-card) / <alpha-value>)',
        'p-ink': 'rgb(var(--lp-ink) / <alpha-value>)',
        'p-dim': 'rgb(var(--lp-dim) / <alpha-value>)',
        'p-line': 'rgb(var(--lp-line) / <alpha-value>)',
        panel: 'rgb(var(--lp-panel) / <alpha-value>)',
        brand: {
          50: '#F1EFFF',
          100: '#E4E0FF',
          200: '#C9C2FF',
          300: '#A99EFF',
          400: '#8B7CFF',
          500: '#6C5CFF',
          600: '#5A4BFF',
          700: '#4A3AE0',
          mint: '#14B8A6',
          violet: '#9333EA',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'JetBrains Mono', 'Menlo', 'Consolas', 'monospace'],
        display: ['var(--font-display)', 'var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        sm: '4px',
        DEFAULT: '6px',
        md: '6px',
        lg: '10px',
        xl: '14px',
        full: '9999px',
      },
      boxShadow: {
        // Админ-тени следуют теме через CSS-переменные (globals.css):
        // dark — чёрная кромка, light — мягкие как .lp-card (lift — с акцентом).
        panel: 'var(--shadow-panel)',
        pop: 'var(--shadow-pop)',
        lift: 'var(--shadow-lift)',
        // Статическая световая тень лендинга.
        card: '0 1px 2px rgb(12 17 22 / 0.04), 0 12px 40px -16px rgb(12 17 22 / 0.18)',
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
