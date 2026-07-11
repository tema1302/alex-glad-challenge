# web/ PRODUCT-редизайн (палитра C «Graphite + Teal») — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Унифицировать 23 страницы `web/` в один dense power-tool UI регистра PRODUCT — палитра C (graphite + teal), IBM Plex (Sans body / Mono headings+data), N3 hybrid-навигация (header + sidebar), без page-load motion, с чисткой orphans.

**Architecture:** Сначала фундамент (токены → шрифты → UI-примитивы → header/sidebar/footer → layout-оболочка), затем снос orphans/error-фиксы, затем проход по 23 страницам 5 архетипами. Дизайн-слой только; `lib/server/*`, `app/api/*`, `data/*`, БД, core/ не трогаются. Tailwind v3 (CSS-вары `R G B`, `@tailwind base/comp/util`). next/font самохостит шрифты (build-time fetch, рантайм same-origin — CSP не меняется).

**Tech Stack:** Next.js 15.1.6 App Router, React 19, Tailwind v3.4.17, next-themes 0.4.4 (forcedTheme dark), next/font/google (IBM Plex Sans + Mono), zod. Верификация: `pnpm --filter web typecheck` + `pnpm --filter web dev` (127.0.0.1) + grep-ассерты. Автотестов/build/lint нет.

## Global Constraints

(Из спецификации `docs/superpowers/specs/2026-07-11-web-product-redesign-design.md`, verbatim.)

- Регистр: **PRODUCT**. Палитра C. Dark-only (`forcedTheme="dark"`). Dense power-tool. Навигация N3 (header + sidebar).
- Токены (CSS vars в `:root`, формат `R G B` для alpha-modifier): `--bg 15 20 23`, `--surface 22 29 33`, `--surface-2 27 36 41`, `--border 35 44 49`, `--border-strong 48 60 66`, `--text 220 227 232`, `--dim 138 151 158`, `--accent 63 184 175`, `--accent-ink 10 16 18`, `--ok 63 184 175`, `--warn 224 162 60`, `--err 224 86 86`.
- Типографика: body IBM Plex Sans; headings/data IBM Plex Mono. Без gradient-text, без text-glow.
- Motion: NO page-load orchestration. Разрешены только hover/focus (`duration-150`), SSE spinner, progress bars, native `<details>`, typing-cursor.
- A11y: body/dim ≥4.5:1; смысловые границы ≥3:1 (`--border-strong`); focus-visible `ring-1 ring-accent`; статус = dot+текст; семантический HTML.
- Репо-инварианты (scoped override день 28): bind 127.0.0.1; CSP `default-src 'self'; script-src 'self'; connect-src 'self'`; no `NEXT_PUBLIC_*` секретов; server-only chokepoint `web/lib/server/challenge.ts` целостен; SQL parameterized (`?`); `web/.next/`, `web/.env.local`, `web/node_modules/`, `.env`, `.data/` — НЕ в git.
- Коммит-дисциплина: ветка `day-30` (текущая). Префикс `day-30:`. Перед каждым коммитом кода — `pnpm --filter web typecheck` зелёный. Со-автор trailer `Co-Authored-By: Claude <noreply@anthropic.com>`.

### Token-name mapping (важно для всех задач)

Spec называет CSS-вары `--text`/`--border`. В Tailwind color-key `text`/`border` конфликтует с utility-классами (`text-text`, `border-border` — путает). Поэтому: **CSS-вары = имена из spec, Tailwind color-keys = алиасы**:

| CSS var (spec) | Tailwind color key | Пример класса |
|---|---|---|
| `--bg` | `bg` | `bg-bg` |
| `--surface` | `surface` | `bg-surface` |
| `--surface-2` | `surface-2` | `bg-surface-2` |
| `--border` | `line` | `border-line` |
| `--border-strong` | `line-strong` | `border-line-strong` |
| `--text` | `ink` | `text-ink` |
| `--dim` | `dim` | `text-dim` |
| `--accent` | `accent` | `bg-accent` / `text-accent` |
| `--accent-ink` | `accent.ink` | `text-accent-ink` |
| `--ok` / `--warn` / `--err` | `ok` / `warn` / `err` | `text-ok` / `text-warn` / `text-err` |

### Class-migration cheatsheet (для прохода по страницам, Tasks 10–14)

| Старый класс | Новый |
|---|---|
| `bg-neutral-950`, `bg-matrix-void`, `bg-matrix-void-deep`, `bg-land-ink` | `bg-bg` |
| `bg-neutral-900`, `bg-matrix-surface`, `bg-matrix-surface-2`, `bg-land-panel` | `bg-surface` |
| `bg-neutral-800`, hover surfaces | `bg-surface-2` |
| `text-neutral-100`, `text-land-bone`, `text-matrix-text` | `text-ink` |
| `text-neutral-400`, `text-neutral-500`, `text-land-dim`, `text-matrix-text-dim` | `text-dim` |
| `border-neutral-800`, `border-matrix-border`, `border-land-line` | `border-line` |
| input/button borders | `border-line-strong` |
| `text-accent` (был green) | `text-accent` (теперь teal — класс тот же) |
| `accent-soft` / `text-matrix-cyan` / `text-matrix-magenta` | удалить (заменить на `text-accent` или `text-dim` по смыслу) |
| `font-mono` | `font-mono` (теперь Plex Mono — класс тот же) |
| `.text-glow*`, `.scanlines`, `.neon-border`, `.gradient-neon`, `.glass`, `.ai-sweep`, `.ai-carrier` | удалить |
| `tracking-[0.35em]`/`[0.25em]` uppercase заголовки | оставить (идентичность B1) |

---

## Task 1: Токены — `tailwind.config.ts` + `globals.css`

**Files:**
- Modify: `web/tailwind.config.ts` (полная перезапись)
- Modify: `web/app/globals.css` (полная перезапись)

**Interfaces:**
- Produces: Tailwind color-keys (`bg/surface/surface-2/line/line-strong/ink/dim/accent/accent.ink/ok/warn/err`), fontFamily (`sans`/`mono`) пока на системные стеки (Task 2 переведёт на `var(--font-*)`). CSS-вары `--bg...--err` в `:root`.

- [ ] **Step 1: Переписать `web/tailwind.config.ts`**

Полное новое содержимое:

```ts
import type { Config } from 'tailwindcss';

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
        },
        ok: 'rgb(var(--ok) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        err: 'rgb(var(--err) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['IBM Plex Sans', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'JetBrains Mono', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '6px',
      },
    },
  },
  plugins: [],
} satisfies Config;
```

Снёс: `matrix.*`, `land.*`, `neutral.*` (green-tinted), старый `accent`/`accent.soft`, `display` (serif), `boxShadow.glow*`, `keyframes.marquee`.

- [ ] **Step 2: Переписать `web/app/globals.css`**

Полное новое содержимое:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color-scheme: dark;

  --bg: 15 20 23;
  --surface: 22 29 33;
  --surface-2: 27 36 41;
  --border: 35 44 49;
  --border-strong: 48 60 66;
  --text: 220 227 232;
  --dim: 138 151 158;
  --accent: 63 184 175;
  --accent-ink: 10 16 18;
  --ok: 63 184 175;
  --warn: 224 162 60;
  --err: 224 86 86;

  background-color: rgb(var(--bg));
}

@layer base {
  html,
  html.dark {
    background-color: rgb(var(--bg));
  }
  body {
    background-color: rgb(var(--bg));
    color: rgb(var(--text));
    font-family: 'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
  }
  ::selection {
    background-color: rgb(var(--accent) / 0.3);
    color: rgb(var(--text));
  }
}

@layer utilities {
  .active-link {
    background-color: rgb(var(--surface-2));
    color: rgb(var(--accent));
    border-left: 2px solid rgb(var(--accent));
  }
  .spin {
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }
}
```

Снёс: все `--mx-*`, `--ai-*`, `.text-glow*`, `.scanlines`, `.glass`, `.neon-border`, `.gradient-neon`, `.ai-sweep`, `.ai-carrier`. Оставил reduced-motion override и добавил `.spin`/`.active-link`.

- [ ] **Step 3: Верификация**

```bash
pnpm --filter web typecheck
```
Expected: PASS (токены не ломают типы; страницы пока ссылаются на старые классы — могут быть Untyped class warnings, но Tailwind не падает на unknown classes; typecheck = tsc, классы не типизируются).

Grep-ассерты (должны быть 0 после всех задач, но после Task 1 — в config/globals именно 0):
```bash
grep -nE "\-\-mx-|\-\-ai-|matrix\.|land\.|text-glow|scanlines|neon-border|gradient-neon|ai-sweep|ai-carrier|glow-cyan|glow-magenta|inset-glow" web/tailwind.config.ts web/app/globals.css
```
Expected: 0 совпадений.

- [ ] **Step 4: Commit**

```bash
git add web/tailwind.config.ts web/app/globals.css
git commit -m "$(cat <<'EOF'
day-30: web tokens — палитра C (Graphite+Teal), снос matrix/land/glow

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: next/font — IBM Plex Sans + Mono

**Files:**
- Modify: `web/app/layout.tsx` (импорты next/font, variables на `<html>`)
- Modify: `web/tailwind.config.ts` (fontFamily → `var(--font-*)`)

**Interfaces:**
- Consumes: Task 1 tokens.
- Produces: CSS-вары `--font-sans`, `--font-mono` на `<html>`; Tailwind `font-sans`/`font-mono` используют их.

**Note:** next/font в Next 15 самохостит шрифты (build-time fetch с Google Fonts → serv из `/_next/static`). Рантайм same-origin → CSP `default-src 'self'` держится. Первый `dev` требует сеть один раз (кэш в `.next`).

- [ ] **Step 1: Обновить `web/tailwind.config.ts` fontFamily**

Заменить блок `fontFamily` на:

```ts
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'JetBrains Mono', 'Menlo', 'Consolas', 'monospace'],
      },
```

- [ ] **Step 2: Добавить next/font в `web/app/layout.tsx`**

Вверху файла (после существующих импортов) добавить:

```tsx
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';

const plexSans = IBM_Plex_Sans({
  subsets: ['cyrillic', 'latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['cyrillic', 'latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});
```

На `<html>` добавить variables:

```tsx
<html lang="ru" suppressHydrationWarning className={`${plexSans.variable} ${plexMono.variable}`}>
```

(Остальное в layout правится в Task 7 — shell.)

- [ ] **Step 3: Верификация**

```bash
pnpm --filter web typecheck
pnpm --filter web dev   #手动: открыть 127.0.0.1:3000, убедиться что body набран Plex Sans (не system). Ctrl+C после проверки.
```
Expected: typecheck PASS; dev поднимается, шрифты применены (визуально отличается от моно-system).

- [ ] **Step 4: Commit**

```bash
git add web/app/layout.tsx web/tailwind.config.ts
git commit -m "$(cat <<'EOF'
day-30: web next/font — IBM Plex Sans (body) + Plex Mono (headings/data)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: UI-примитивы (`web/app/components/ui/`)

**Files:**
- Create: `web/app/components/ui/Tile.tsx`
- Create: `web/app/components/ui/Card.tsx`
- Create: `web/app/components/ui/Button.tsx`
- Create: `web/app/components/ui/StatusDot.tsx`
- Create: `web/app/components/ui/SectionLabel.tsx`

**Interfaces:**
- Produces: переиспользуемые примитивы для всех страниц. Props ниже.

- [ ] **Step 1: `Tile.tsx`**

```tsx
import { ReactNode } from 'react';

export function Tile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2">
      <div className="font-mono text-xs uppercase tracking-wider text-dim">{label}</div>
      <div className="mt-1 font-mono text-lg text-ink">{value}</div>
      {hint ? <div className="mt-0.5 font-mono text-[11px] text-dim">{hint}</div> : null}
    </div>
  );
}
```

- [ ] **Step 2: `Card.tsx`**

```tsx
import { ReactNode } from 'react';

export function Card({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-line bg-surface p-4">
      {label ? (
        <div className="mb-3 font-mono text-xs uppercase tracking-wider text-dim">// {label}</div>
      ) : null}
      {children}
    </section>
  );
}
```

- [ ] **Step 3: `Button.tsx`**

```tsx
import { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:brightness-110',
  ghost: 'border border-line-strong text-dim hover:text-ink',
  danger: 'border border-err/60 text-err hover:bg-err/10',
};

export function Button({
  variant = 'ghost',
  className = '',
  children,
  ...rest
}: { variant?: Variant; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex min-h-[32px] items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 4: `StatusDot.tsx`**

```tsx
import { ReactNode } from 'react';

type Status = 'ok' | 'warn' | 'err' | 'off';

const MAP: Record<Status, { dot: string; text: string; label: string }> = {
  ok: { dot: 'bg-ok', text: 'text-ok', label: 'ok' },
  warn: { dot: 'bg-warn', text: 'text-warn', label: 'warn' },
  err: { dot: 'bg-err', text: 'text-err', label: 'err' },
  off: { dot: 'bg-dim', text: 'text-dim', label: 'off' },
};

export function StatusDot({ status, label }: { status: Status; label?: ReactNode }) {
  const m = MAP[status];
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs">
      <span className={`inline-block h-2 w-2 rounded-full ${m.dot}`} />
      <span className={m.text}>{label ?? m.label}</span>
    </span>
  );
}
```

- [ ] **Step 5: `SectionLabel.tsx`**

```tsx
export function SectionLabel({ children }: { children: string }) {
  return (
    <div className="mb-3 font-mono text-xs uppercase tracking-wider text-dim">// {children}</div>
  );
}
```

- [ ] **Step 6: Верификация**

```bash
pnpm --filter web typecheck
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/app/components/ui/
git commit -m "$(cat <<'EOF'
day-30: web UI-примитивы — Tile/Card/Button/StatusDot/SectionLabel (C, dense)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Header — `Nav.tsx` перезапись

**Files:**
- Modify: `web/app/components/Nav.tsx` (полная перезапись)

**Interfaces:**
- Consumes: `data/nav.ts` (первая группа `core`), `lib/server/env.ts` (`getKeysStatus` для model-status — server component, safe).
- Produces: `<Nav />` server component — header (brand + core links + active-model status). Больше НЕ рендерит `ThemeToggle`.

- [ ] **Step 1: Переписать `web/app/components/Nav.tsx`**

```tsx
import Link from 'next/link';
import { navGroups } from '../../data/nav';
import { getActiveModel } from '../../lib/server/env';

const core = navGroups.find((g) => g.id === 'core') ?? navGroups[0];

export function Nav() {
  const model = getActiveModel(); // { provider, model } | null — без значений ключей
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/95 backdrop-blur">
      <div className="flex h-12 items-center justify-between px-5">
        <Link href="/" className="font-mono text-sm font-semibold tracking-tight text-ink">
          Артемий
          <span className="text-accent">·</span>
          <span className="text-dim">AI</span>
        </Link>
        <nav className="flex items-center gap-1">
          {core.items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              className="rounded-md px-2 py-1 text-sm text-dim transition-colors duration-150 hover:text-ink"
            >
              {it.label}
            </Link>
          ))}
        </nav>
        <div className="font-mono text-xs text-dim">
          {model ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-ok" />
              {model.provider} · {model.model}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-dim" />
              no-key
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
```

**Note:** `getActiveModel()` — accessor из `lib/server/env.ts`. Если такого accessor нет — использовать существующий `getKeysStatus()` и показать `provider` из него. Executor: проверить `web/lib/server/env.ts`, выбрать accessor, который возвращает public-мету модели (значения ключей NEVER). Если accessor возвращает только флаги — показать `<StatusDot status={ok|off} label="DeepSeek" />`.

- [ ] **Step 2: Верификация**

```bash
pnpm --filter web typecheck
```
Expected: PASS. Если `getActiveModel` нет — добавить тонкий accessor в `env.ts` (public-мета только) или использовать `getKeysStatus`.

- [ ] **Step 3: Commit**

```bash
git add web/app/components/Nav.tsx
git commit -m "$(cat <<'EOF'
day-30: web header — Nav rewrite (brand + core + model-status), снос ThemeToggle

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Sidebar — `Sidebar.tsx`

**Files:**
- Create: `web/app/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `data/nav.ts` (`navGroups`), `next/navigation` `usePathname`.
- Produces: `<Sidebar />` client component — groups в `<details>`, active-link.

- [ ] **Step 1: Создать `web/app/components/Sidebar.tsx`**

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navGroups } from '../../data/nav';

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sticky top-12 h-[calc(100vh-3rem)] w-56 shrink-0 overflow-y-auto border-r border-line px-3 py-4">
      {navGroups.map((g) => {
        const hasActive = g.items.some((it) => pathname === it.href || pathname.startsWith(it.href + '/'));
        return (
          <details key={g.id} open={hasActive} className="group mb-3">
            <summary className="cursor-pointer select-none font-mono text-[11px] uppercase tracking-wider text-dim hover:text-ink">
              {g.label}
            </summary>
            <div className="mt-1 flex flex-col">
              {g.items.map((it) => {
                const active = pathname === it.href || pathname.startsWith(it.href + '/');
                return (
                  <Link
                    key={it.href}
                    href={it.href}
                    className={`rounded-md px-2 py-1 text-sm transition-colors duration-150 ${
                      active
                        ? 'active-link'
                        : 'text-dim hover:bg-surface-2 hover:text-ink'
                    }`}
                  >
                    {it.label}
                  </Link>
                );
              })}
            </div>
          </details>
        );
      })}
    </aside>
  );
}
```

**Note:** проверь форму `navGroups` в `data/nav.ts` — поля `id`/`label`/`items[{href,label}]`. Если ID/label называются иначе — поправить под фактическую схему.

- [ ] **Step 2: Верификация**

```bash
pnpm --filter web typecheck
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/app/components/Sidebar.tsx
git commit -m "$(cat <<'EOF'
day-30: web sidebar — группы nav.ts в <details>, active-link teal

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Footer — `Footer.tsx` перезапись

**Files:**
- Modify: `web/app/components/Footer.tsx` (полная перезапись)

**Interfaces:**
- Consumes: `data/nav.ts`.

- [ ] **Step 1: Переписать `web/app/components/Footer.tsx`**

```tsx
import Link from 'next/link';
import { navGroups } from '../../data/nav';

export function Footer() {
  const flat = navGroups.flatMap((g) => g.items);
  return (
    <footer className="mt-auto border-t border-line px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-dim">
        {flat.map((it) => (
          <Link key={it.href} href={it.href} className="transition-colors duration-150 hover:text-ink">
            {it.label}
          </Link>
        ))}
      </div>
    </footer>
  );
}
```

- [ ] **Step 2: Верификация**

```bash
pnpm --filter web typecheck
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/app/components/Footer.tsx
git commit -m "day-30: web footer — compact one-row mirror nav (C)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: Layout shell — `layout.tsx`

**Files:**
- Modify: `web/app/layout.tsx` (shell: header + sidebar + main + footer; снос комментария MatrixRain)

**Interfaces:**
- Consumes: Task 2 (next/font vars), Task 4 (`Nav`), Task 5 (`Sidebar`), Task 6 (`Footer`).

- [ ] **Step 1: Переписать тело `RootLayout` в `web/app/layout.tsx`**

(Импорты next/font из Task 2 уже на месте.) Заменить `return (...)` на:

```tsx
  return (
    <html lang="ru" suppressHydrationWarning className={`${plexSans.variable} ${plexMono.variable}`}>
      <body className="min-h-screen bg-bg font-sans text-ink antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark" disableTransitionOnChange>
          <div className="flex min-h-screen flex-col">
            <Nav />
            <div className="flex flex-1">
              <Sidebar />
              <main className="flex-1 px-5 py-6">
                <div className="mx-auto max-w-6xl">{children}</div>
              </main>
            </div>
            <Footer />
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
```

Добавить импорты: `import { Nav } from './components/Nav';`, `import { Sidebar } from './components/Sidebar';`, `import { Footer } from './components/Footer';`. Снести комментарий про MatrixRain (если был в файле).

**Note:** `ThemeProvider` (next-themes, forcedTheme dark) остаётся — управляет `class="dark"` на `<html>`. Контейнер больше НЕ `max-w-6xl mx-auto` на верхнем уровне (как было) — main получил внутренний max-w; sidebar лежит рядом.

- [ ] **Step 2: Верификация**

```bash
pnpm --filter web typecheck
pnpm --filter web dev   # визуально: header сверху sticky, sidebar слева, main справа, footer внизу. Ctrl+C.
```
Expected: typecheck PASS; shell рендерится (контент страниц пока со старыми классами — ugly, починится в Tasks 10–14).

- [ ] **Step 3: Commit**

```bash
git add web/app/layout.tsx
git commit -m "$(cat <<'EOF'
day-30: web layout shell — header + sidebar + main + footer (N3 hybrid)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Orphan-чистка — `MatrixRain.tsx`, `ThemeToggle.tsx`

**Files:**
- Delete: `web/app/components/MatrixRain.tsx`
- Delete: `web/app/components/ThemeToggle.tsx`

**Interfaces:**
- Consumes: подтверждение, что ни одна страница/компонент не импортирует эти файлы (после Task 4 Nav уже не ссылается ThemeToggle).

- [ ] **Step 1: Проверить отсутствие ссылок**

```bash
grep -rn "MatrixRain\|ThemeToggle" web/app web/lib web/data 2>/dev/null
```
Expected: 0 совпадений (если есть — удалить эти импорты/рендер сначала).

- [ ] **Step 2: Удалить файлы**

```bash
rm web/app/components/MatrixRain.tsx web/app/components/ThemeToggle.tsx
```

- [ ] **Step 3: Верификация**

```bash
pnpm --filter web typecheck
grep -rn "MatrixRain\|ThemeToggle" web/app 2>/dev/null
```
Expected: typecheck PASS; grep 0.

- [ ] **Step 4: Commit**

```bash
git add -A web/app/components/
git commit -m "day-30: web — удалить orphan MatrixRain.tsx и ThemeToggle.tsx

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: Error-страницы — C-палитра

**Files:**
- Modify: `web/app/error.tsx`
- Modify: `web/app/global-error.tsx`

- [ ] **Step 1: Переписать `web/app/error.tsx`**

Сохранить клиент-природу (`'use client'`) и reset-логику. Заменить палитру: `red-*` → C + `err` для семантики.

```tsx
'use client';

import { useEffect } from 'react';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl py-16">
      <div className="font-mono text-xs uppercase tracking-wider text-err">// error</div>
      <h1 className="mt-2 font-mono text-2xl uppercase tracking-tight text-ink">Что-то сломалось</h1>
      <p className="mt-2 text-sm text-dim">{error.message || 'Необработанная ошибка сегмента.'}</p>
      {error.digest ? <p className="mt-1 font-mono text-xs text-dim">digest: {error.digest}</p> : null}
      <button
        onClick={reset}
        className="mt-6 inline-flex min-h-[36px] items-center rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
      >
        Повторить
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Переписать `web/app/global-error.tsx`**

Boundary грузится без Tailwind-дерева → inline-стили, но в C-палитре (hex напрямую):

```tsx
'use client';

import { useEffect } from 'react';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="ru">
      <body style={{ background: '#0F1417', color: '#DCE3E8', fontFamily: 'IBM Plex Sans, system-ui, sans-serif', padding: '3rem', maxWidth: '36rem', margin: '0 auto' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, ui-monospace, monospace', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#E05656' }}>// fatal error</div>
        <h1 style={{ fontFamily: 'IBM Plex Mono, ui-monospace, monospace', fontSize: '1.5rem', textTransform: 'uppercase', margin: '0.5rem 0', color: '#DCE3E8' }}>Глобальный сбой</h1>
        <p style={{ fontSize: '0.875rem', color: '#8A979E' }}>{error.message || 'Корневая ошибка приложения.'}</p>
        <button
          onClick={reset}
          style={{ marginTop: '1.5rem', background: '#3FB8AF', color: '#0A1012', border: 'none', borderRadius: '6px', padding: '0.4rem 0.9rem', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}
        >
          Повторить
        </button>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Верификация**

```bash
pnpm --filter web typecheck
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/app/error.tsx web/app/global-error.tsx
git commit -m "day-30: web error-страницы — C-палитра (error.tsx Tailwind, global-error inline)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 10: Архетип Landing — `app/page.tsx`

**Files:**
- Modify: `web/app/page.tsx`

**Interfaces:**
- Consumes: Task 1 tokens, Task 3 примитивы (`Tile`, `Card`, `SectionLabel`), live-данные из БД (существующие server-импорты — НЕ менять).

- [ ] **Step 1: Перечитать `web/app/page.tsx`** и инвентаризовать секции (hero plate, counters, manifesto, process-ledger, 30-day chart, CTA). Запомнить какие данные тянутся из БД/server — НЕ трогать эти импорты.

- [ ] **Step 2: Переписать разметку под C**

Применить class-migration cheatsheet + перейти на примитивы. Скелет:

```tsx
// server component, force-dynamic — оставить
export const dynamic = 'force-dynamic';

export default function Page() {
  // ...существующие server-импорты данных НЕ трогать...
  return (
    <div className="space-y-8">
      <section>
        <SectionLabel>landing · v30</SectionLabel>
        <h1 className="font-mono text-3xl font-semibold uppercase tracking-tight text-ink">
          АРТЕМИЙ <span className="text-accent">·</span> AI-ИНЖЕНЕР
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-dim">{/* tagline */}</p>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Дней" value={30} />
          <Tile label="Разделов" value={23} />
          <Tile label="Модулей" value={6} />
          <Tile label="Локально" value="100%" />
        </div>
      </section>

      <section>
        <SectionLabel>process ledger</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {/* map modules → <Card label={...}>{...}</Card> */}
        </div>
      </section>

      <section>
        <SectionLabel>30-day build</SectionLabel>
        {/* chart: bar+value-label (не только цвет). Каждая колонка — <div> с высотой + text-dim value */}
      </section>

      <section>
        <a href="/dashboard" className="inline-flex min-h-[40px] items-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink">
          Открыть dashboard →
        </a>
      </section>
    </div>
  );
}
```

Снести: `bg-land-*`, `text-land-*`, `ai-sweep`, `ai-carrier`, `font-sans` на обёртке (теперь глобально), uppercase H1 — оставить (B1).

- [ ] **Step 3: Верификация**

```bash
pnpm --filter web typecheck
pnpm --filter web dev   # посетить / — hero, tiles, ledger, chart, CTA видны. Live-счётчики из БД работают. Ctrl+C.
```
Expected: typecheck PASS; landing в C-палитре, live-data подгружается.

- [ ] **Step 4: Commit**

```bash
git add web/app/page.tsx
git commit -m "day-30: web landing — PRODUCT C (Tile/Card/SectionLabel, live-data, без load-motion)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 11: Архетип Dashboard — `app/dashboard/page.tsx`

**Files:**
- Modify: `web/app/dashboard/page.tsx`

- [ ] **Step 1: Перечитать страницу**, инвентаризовать stat-виджеты (news/posts/style/RAG/TG/dialog), keys-status, active-model.

- [ ] **Step 2: Переписать под C** — stat-grid через `<Tile>`, ключи через `<StatusDot status={configured ? 'ok':'off'} label="DeepSeek" />` (значения NEVER), модель — `<StatusDot status="ok" label={model} />`.

Скелет:

```tsx
<div className="space-y-6">
  <section>
    <SectionLabel>db stats</SectionLabel>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Tile label="News" value={stats.news} />
      <Tile label="Posts" value={stats.posts} />
      {/* ...style/RAG/TG/dialog... */}
    </div>
  </section>
  <section>
    <SectionLabel>keys</SectionLabel>
    <div className="flex flex-wrap gap-3">
      <StatusDot status={keys.deepseek ? 'ok' : 'off'} label="DeepSeek" />
      <StatusDot status={keys.openrouter ? 'ok' : 'off'} label="OpenRouter" />
      {/* ...остальные — Булевы флаги, без значений... */}
    </div>
  </section>
</div>
```

- [ ] **Step 3: Верификация + Commit** (как в Task 10). Commit msg: `day-30: web dashboard — C stat-grid + keys StatusDot (bool only)`.

---

## Task 12: Архетип Data-list (5 страниц)

**Files:**
- Modify: `web/app/blog/posts/page.tsx`
- Modify: `web/app/rag/chats/page.tsx`
- Modify: `web/app/chat/page.tsx`
- Modify: `web/app/mcp/tools/page.tsx`
- Modify: `web/app/admin/servers/page.tsx`

- [ ] **Step 1: Шаблон data-list** — `<table>` с hairline rows + `<SectionLabel>` + опц. пустой-state. Применить cheatsheet.

```tsx
<div className="space-y-4">
  <SectionLabel>сущности</SectionLabel>
  <div className="overflow-x-auto rounded-md border border-line">
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-line text-left">
          <th className="px-3 py-2 font-mono text-xs uppercase tracking-wider text-dim">col</th>
          {/* ... */}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-b border-line transition-colors duration-150 hover:bg-surface-2">
            <td className="px-3 py-2 text-ink">{r.col}</td>
            {/* ... */}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
</div>
```

- [ ] **Step 2: Применить к каждой из 5 страниц** по очереди (читать → заменять классы/структуру под шаблон, сохраняя логику/данные).

- [ ] **Step 3: Верификация**

```bash
pnpm --filter web typecheck
pnpm --filter web dev   # пройти по 5 роутам, убедиться таблицы/карточки рендерятся. Ctrl+C.
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/app/blog/posts/page.tsx web/app/rag/chats/page.tsx web/app/chat/page.tsx web/app/mcp/tools/page.tsx web/app/admin/servers/page.tsx
git commit -m "$(cat <<'EOF'
day-30: web data-list архетип — 5 страниц в C (table hairline + SectionLabel)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Архетип Form/REPL (13 страниц)

**Files:**
- Modify (по очереди):
  - `web/app/rag/page.tsx`, `web/app/rag/chat/[dialogChatId]/page.tsx`
  - `web/app/chat/[sessionId]/page.tsx`
  - `web/app/blog/news/page.tsx`, `web/app/blog/pipeline/page.tsx`, `web/app/blog/scout/page.tsx`
  - `web/app/tg/collect/page.tsx`, `web/app/telegram/publish/page.tsx`
  - `web/app/mcp/call/page.tsx`, `web/app/agent/page.tsx`
  - `web/app/rag/index/page.tsx`, `web/app/rag/index-tg/page.tsx`
  - `web/app/settings/page.tsx`

- [ ] **Step 1: Шаблон form/REPL** — `<input>`/`<textarea>` (`bg-surface-2 border-line-strong focus-visible:ring-1 focus-visible:ring-accent`), `<Button>`, SSE-зона (`<Card>` со spinner `.spin` + progress), chat-bubbles (assistant `bg-surface`, user `bg-surface-2`, **без side-tab**, role-label `font-mono text-xs uppercase text-dim`).

- [ ] **Step 2: Применить к 13 страницам.** Логику/SSE/стриминг НЕ трогать — только классы/обёртки/кнопки. index-tg сохранить destructive-confirm gating.

- [ ] **Step 3: Верификация**

```bash
pnpm --filter web typecheck
pnpm --filter web dev   # smoke по репрезентативным: /rag, /chat/[id], /blog/news, /settings. Ctrl+C.
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/app/rag/page.tsx "web/app/rag/chat/[dialogChatId]/page.tsx" "web/app/chat/[sessionId]/page.tsx" web/app/blog/news/page.tsx web/app/blog/pipeline/page.tsx web/app/blog/scout/page.tsx web/app/tg/collect/page.tsx web/app/telegram/publish/page.tsx web/app/mcp/call/page.tsx web/app/agent/page.tsx web/app/rag/index/page.tsx web/app/rag/index-tg/page.tsx web/app/settings/page.tsx
git commit -m "$(cat <<'EOF'
day-30: web form/REPL архетип — 13 страниц в C (input/Button/SSE/chat, без load-motion)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Архетип Read-only brief (4 страницы)

**Files:**
- Modify: `web/app/briefing/page.tsx`, `web/app/summary/page.tsx`, `web/app/tg/top/page.tsx`, `web/app/showcase/page.tsx`

- [ ] **Step 1: Шаблон read-only** — типографические блоки: `<SectionLabel>` + `<Card>`/параграфы `text-ink`, secondary `text-dim`. Showcase capability-секции → `<Card label>` сетка; architecture-layers → нумерованный список mono-labels.

- [ ] **Step 2: Применить к 4 страницам.**

- [ ] **Step 3: Верификация**

```bash
pnpm --filter web typecheck
pnpm --filter web dev   # smoke 4 роута. Ctrl+C.
```

- [ ] **Step 4: Commit**

```bash
git add web/app/briefing/page.tsx web/app/summary/page.tsx web/app/tg/top/page.tsx web/app/showcase/page.tsx
git commit -m "$(cat <<'EOF'
day-30: web read-only архетип — 4 страницы в C (SectionLabel/Card типографика)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Финальная валидация

**Files:** (без правок — только проверка)

- [ ] **Step 1: Полный typecheck**

```bash
pnpm --filter web typecheck
```
Expected: PASS.

- [ ] **Step 2: Полный dev-дым**

```bash
pnpm --filter web dev
```
Пройти по всем 23 роутам (список — `data/nav.ts`). Каждый рендерится без 500, в C-палитре, sidebar active-link подсвечивает текущую. Ctrl+C.

- [ ] **Step 3: Bundle secret-leak grep** (после того как dev хотя бы раз скомпилировал `.next`):

```bash
grep -rlE "telegram|TG_SESSION|DEEPSEEK_API_KEY|OPENROUTER_API_KEY|TG_BOT_TOKEN" web/.next/static 2>/dev/null
```
Expected: 0 совпадений.

- [ ] **Step 4: Остаточный grep старых регистров**

```bash
grep -rnE "bg-matrix|text-matrix|bg-land|text-land|bg-neutral|text-neutral|border-neutral|text-glow|scanlines|neon-border|gradient-neon|ai-sweep|ai-carrier|--mx-|--ai-" web/app web/tailwind.config.ts web/app/globals.css 2>/dev/null
```
Expected: 0 совпадений (допускаются совпадения в комментариях — вычистить).

- [ ] **Step 5: A11y spot-check** — открыть `/`, `/dashboard`, `/chat/[id]`; убедиться: фокус-кольцо teal на табах через клавиатуру, статус не только цветом (dot+текст), reduced-motion (DevTools → Rendering → reduce) глушит spinner.

- [ ] **Step 6: Финальный commit** (если остались правки по шагам 3–4) + push не делать без запроса.

```bash
git status --short   # убедиться что clean или только ожидаемое
```

---

## Само-ревью (выполнено автором плана)

- **Spec coverage:** §5 токены → Task 1; §6 типографика → Task 2; §7 layout/nav → Tasks 4–7; §8 компоненты → Task 3 (+ page tasks); §9 motion → Task 1 (снос keyframes) + все sweep tasks (без load-motion); §10 a11y → Task 3 (focus/ring/dot+text) + Task 15 (spot-check); §11 orphans → Tasks 8–9; §12 миграция → Tasks 10–14; §14 критерии → Task 15. Покрыто.
- **Placeholder scan:** «(если такого accessor нет)» в Task 4 — намеренная развилка (executor проверит `env.ts`); не placeholder. Шаблоны страниц в Tasks 10–14 дают полный эталонный код + cheatsheet, конкретный контент тянется из существующих server-импортов (логику не плодим).
- **Type consistency:** `getActiveModel` упомянут в Task 4 — если accessor называется иначе, executor правит под фактический `env.ts` (развилка указана). Token-keys (`bg/surface/line/ink/dim/accent/ok/warn/err`) едины по всему плану. `navGroups.id/label/items` — развилка в Task 5 на случай другой схемы.
- **Adaptation note:** автотестов нет (инвариант стека) → verification = `typecheck` + `dev` smoke + `grep` ассерты, не TDD-шаги. Это осознанное отклонение от TDD-шаблона скилла под реалии репо.
