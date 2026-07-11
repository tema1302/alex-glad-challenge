// Tailwind v3 + Next 15. darkMode 'class' — для next-themes (forcedTheme="dark").
//
// Дизайн-система Matrix: accent = фосфор-green, neutral-рампа перекомпонована в
// green-tinted void (dark:bg-neutral-900 / text-neutral-500 и пр. дают Matrix-вид
// авто, без правок 22 страниц). Декоративные cyan/magenta — в namespace matrix.*.
// Красная линия: Tailwind red/green/amber НЕ переопределяются (семантика ✓/error/warn).
// white НЕ трогается (text-white). Все override в формате rgb(var(--mx-*) / <alpha-value>),
// чтобы opacity-modifier (bg-accent/10, dark:bg-neutral-900/40) работал.
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './data/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: 'rgb(var(--mx-green) / <alpha-value>)', // #00ff66 фосфор
          soft: 'rgb(var(--mx-cyan) / <alpha-value>)', // #00e5ff
        },
        // green-tinted void-рампа: dark:bg-neutral-900 → glass-surface, text-neutral-500 → muted.
        neutral: {
          50: 'rgb(var(--mx-surface-2) / <alpha-value>)',
          100: 'rgb(var(--mx-text) / <alpha-value>)',
          200: 'rgb(var(--mx-border) / <alpha-value>)',
          300: 'rgb(var(--mx-text-dim) / <alpha-value>)',
          400: 'rgb(var(--mx-text-dim) / <alpha-value>)',
          500: 'rgb(var(--mx-text-dim) / <alpha-value>)',
          600: 'rgb(var(--mx-void) / <alpha-value>)',
          700: 'rgb(var(--mx-border) / <alpha-value>)',
          800: 'rgb(var(--mx-border) / <alpha-value>)',
          900: 'rgb(var(--mx-surface) / <alpha-value>)',
          950: 'rgb(var(--mx-void) / <alpha-value>)',
        },
        matrix: {
          void: 'rgb(var(--mx-void) / <alpha-value>)',
          'void-deep': 'rgb(var(--mx-void-deep) / <alpha-value>)',
          surface: 'rgb(var(--mx-surface) / <alpha-value>)',
          'surface-2': 'rgb(var(--mx-surface-2) / <alpha-value>)',
          green: 'rgb(var(--mx-green) / <alpha-value>)',
          bright: 'rgb(var(--mx-green-bright) / <alpha-value>)',
          cyan: 'rgb(var(--mx-cyan) / <alpha-value>)',
          magenta: 'rgb(var(--mx-magenta) / <alpha-value>)',
          amber: 'rgb(var(--mx-amber) / <alpha-value>)',
          red: 'rgb(var(--mx-red) / <alpha-value>)',
        },
        // Landing-scoped палитра (machine-nameplate). НЕ переопределяет neutral/matrix/accent —
        // 23 внутренние страницы не меняются. Amber-on-ink instrumentation, не acid-green дефолт.
        land: {
          ink: 'rgb(var(--ai-ink) / <alpha-value>)',
          panel: 'rgb(var(--ai-panel) / <alpha-value>)',
          line: 'rgb(var(--ai-line) / <alpha-value>)',
          bone: 'rgb(var(--ai-bone) / <alpha-value>)',
          dim: 'rgb(var(--ai-dim) / <alpha-value>)',
          amber: 'rgb(var(--ai-amber) / <alpha-value>)',
          teal: 'rgb(var(--ai-teal) / <alpha-value>)',
        },
      },
      fontFamily: {
        mono: [
          'ui-monospace',
          "'JetBrains Mono'",
          "'Fira Code'",
          "'SF Mono'",
          "'Cascadia Code'",
          'Menlo',
          'Consolas',
          "'Liberation Mono'",
          'monospace',
        ],
        // Display для editorial-заголовков лендинга. Без fetch — системный стек,
        // характер через контраст с mono-body. На Win → Palatino Linotype/Georgia.
        display: [
          'ui-serif',
          "'Iowan Old Style'",
          "'Palatino Linotype'",
          'Palatino',
          'Georgia',
          'serif',
        ],
        // Landing body: humanist sans — контраст к mono display/data. Дефолт «mono-everything» = смерть личности.
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          "'Segoe UI'",
          'Roboto',
          "'Helvetica Neue'",
          'Arial',
          'sans-serif',
        ],
      },
      boxShadow: {
        glow: '0 0 12px rgba(0,255,102,0.45)',
        'glow-cyan': '0 0 12px rgba(0,229,255,0.45)',
        'glow-magenta': '0 0 12px rgba(255,43,214,0.45)',
        'inset-glow': 'inset 0 0 12px rgba(0,255,102,0.15)',
      },
      keyframes: {
        marquee: {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        marquee: 'marquee 32s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
