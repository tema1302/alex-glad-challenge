# Design System Master File — AI Dev Tool (alex-glad-challenge)

> **LOGIC:** При сборке конкретной страницы сначала читать `design-system/ai-dev-tool/pages/[page-name].md`.
> Если файл существует — его правила **переопределяют** этот Master.
> Если нет — строго следовать правилам ниже.

---

**Проект:** AI Dev Tool (лендинг стэка alex-glad-challenge: локальные LLM-агенты, RAG, MCP, TG-автоматизация)
**Создан:** 2026-07-20
**Канон-совместимость:** `web/` (Next.js 15 App Router + React 19), день-30 Graphite+Teal
**Design Dials:** Variance 8/10 (Bold / Asymmetric) | Motion 6/10 (Standard) | Density 5/10 (Standard)
**Тема:** **forcedTheme="dark"** — только тёмная, light-режима нет (см. `web/app/layout.tsx`)

---

## Global Rules

### Color Palette (Канон Graphite+Teal, dark-only)

Палитра зафиксирована в `web/app/globals.css` как RGB-triplets. В коде использовать
**только tailwind-токены** (`bg-bg`, `text-ink`, `border-accent` и т.д.) или
`rgb(var(--x) / <alpha-value>)` — **НЕ хардкодить hex** в компонентах.

| Tailwind token | CSS var | RGB | Hex (только для справки) | Назначение |
|---|---|---|---|---|
| `bg-bg` | `--bg` | `15 20 23` | `#0F1417` | Graphite base (фон страниц) |
| `bg-surface` | `--surface` | `22 29 33` | `#161D21` | Карточки, basic surfaces |
| `bg-surface-2` | `--surface-2` | `27 36 41` | `#1B2429` | Поднятые карточки, nav, bento tile hover |
| `border-line` | `--border` | `35 44 49` | `#232C31` | Тонкие границы |
| `border-line-strong` | `--border-strong` | `48 60 66` | `#303C42` | Сильные границы, разделители секций |
| `text-ink` | `--text` | `220 227 232` | `#DCE3E8` | Основной текст (contrast vs bg ≈ 13:1 AAA) |
| `text-dim` | `--dim` | `138 151 158` | `#8A979E` | Приглушённый текст, labels, meta (4.6:1 AA) |
| `bg-accent` / `text-accent` | `--accent` | `63 184 175` | `#3FB8AF` | **Teal** — primary CTA, links, active state |
| `bg-accent-ink` | `--accent-ink` | `10 16 18` | `#0A1012` | Текст/иконка на teal-фоне |
| `text-ok` | `--ok` | `63 184 175` | `#3FB8AF` | Success (= teal) |
| `text-warn` | `--warn` | `224 162 60` | `#E0A23C` | Warning (amber) |
| `text-err` | `--err` | `224 86 86` | `#E05656` | Error / destructive |

**Color Notes:**
- Teal (`--accent`) — единственный акцент. Аналог «generation-pink» из движка **НЕ вводим** (решение A: консистентность с /joker /ask /files /dashboard).
- Каждая meaningful-карточка в bento получает teal-деталь (иконка, мини-чип, или hover-border) — это и есть визуальная «привязка» к бренду.

### Typography (Канон IBM Plex)

Шрифты подключены в `web/app/layout.tsx` через `next/font/google` — **self-hosted**
(Next.js хостит файлы локально, **без** Google Fonts CDN). CSP `'self'` соблюдается.

- **Body / Heading:** IBM Plex Sans → `--font-sans` (subset: cyrillic+latin, weights 400/500/600, `display: swap`)
- **Mono / Code / Числа:** IBM Plex Mono → `--font-mono` (subset: cyrillic+latin, weights 400/500, `display: swap`)

Tailwind-классы: `font-sans` (по умолчанию на `<body>`), `font-mono` для code/hero-акцента/цифр/метрик.

**НЕ ДОБАВЛЯТЬ:**
- `@import url(...)` Google Fonts в CSS — сломает CSP `style-src 'self'`.
- Новые семейства (Fira/Inter/JetBrains) — канон уже устоялся, новые шрифты = дробление.

**Type scale (рекомендованный, Tailwind classes):**

| Уровень | Class | Размер | Где |
|---|---|---|---|
| Hero title | `font-mono text-4xl md:text-6xl uppercase tracking-tight` | 36–60px | Hero headline (dev-tool ритм: mono) |
| Section title | `font-mono text-2xl font-semibold uppercase tracking-tight` | 24px | Заголовки секций (как в существующих pages) |
| Card title | `font-sans text-lg font-semibold` | 18px | Bento tile title |
| Body | `font-sans text-sm md:text-base` | 14–16px | Основной текст |
| Label / meta | `font-mono text-xs uppercase tracking-wider text-dim` | 12px | Метки, цифры, статус (как в существующих pages) |

### Spacing Variables

*Density: 5/10 — Standard*

| Token | Value | Usage |
|---|---|---|
| `--space-xs` | `4px` / `0.25rem` | Tight gaps |
| `--space-sm` | `8px` / `0.5rem` | Icon gaps, inline spacing |
| `--space-md` | `16px` / `1rem` | Standard padding |
| `--space-lg` | `24px` / `1.5rem` | Section padding, bento gap на desktop |
| `--space-xl` | `32px` / `2rem` | Bento gap mobile, между секциями |
| `--space-2xl` | `48px` / `3rem` | Section margins |
| `--space-3xl` | `64px` / `4rem` | Hero padding |

Tailwind: использовать стандартную шкалу (`gap-4`, `py-8`, `px-6` и т.д.) — она уже 4/8-кратная.

### Border Radius (ВАЖНО — override для bento)

Канон `web/tailwind.config.ts`: `borderRadius.DEFAULT = 6px`. Это **слишком маленький** для bento.

- **Bento-карточки:** `rounded-2xl` (16px) или `rounded-3xl` (24px) — явно в className
- **Кнопки, inputs, chips:** `rounded` (default 6px) или `rounded-md` — канон
- **Модалы:** `rounded-2xl` (16px)

### Shadow Depths (адаптировано под dark-only)

На тёмном фоне тени слабо видны — bento опирается на **границы + surface-contrast**, не на тени.

| Level | Value | Usage |
|---|---|---|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.4)` | Subtle lift (редко) |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.5)` | Bento tile hover |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.55)` | Modals, dropdowns |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.6)` | Hero featured, overlays |

Primary-разделитель карточек: `border border-line` (повсеместно), на hover → `border-line-strong`.
Hover-lift: `bg-surface-2` + `border-line-strong` (НЕ shadow как primary-средство).

---

## Component Specs

### Buttons (Teal primary)

```tsx
// Primary — teal, только одна primary на экран
<button className="rounded bg-accent px-6 py-3 font-sans text-sm font-semibold text-accent-ink transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg">
  Открыть дашборд
</button>

// Secondary — outline teal
<button className="rounded border border-accent px-6 py-3 font-sans text-sm font-semibold text-accent transition hover:bg-accent hover:text-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
  Документация
</button>

// Tertiary / ghost — surface
<button className="rounded px-4 py-2 font-sans text-sm text-dim transition hover:bg-surface-2 hover:text-ink">
  Подробнее
</button>
```

Требования: `cursor-pointer` (для non-button элементов), `focus-visible:ring-accent`, transition 150–200ms.

### Bento Card (основа стиля)

```tsx
<article className="group rounded-2xl border border-line bg-surface p-6 transition hover:border-line-strong hover:bg-surface-2 motion-safe:transform-gpu">
  <div className="mb-3 flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-accent">
    {/* Lucide-иконка 16x16, teal */}
    <span>comp-name</span>
  </div>
  <h3 className="font-sans text-lg font-semibold text-ink">Заголовок фичи</h3>
  <p className="mt-2 font-sans text-sm text-dim">Описание. Real content, не lorem.</p>
</article>
```

Grid-layout (bento spans): `md:grid-cols-4 md:grid-rows-[200px] md:auto-rows-[200px]` + tile-span через `md:col-span-2` / `md:row-span-2`.

### Inputs

```tsx
<input
  className="rounded border border-line bg-surface px-4 py-3 font-sans text-sm text-ink transition placeholder:text-dim focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
  placeholder="email"
/>
```

### Modals

```tsx
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
  <div className="w-[90%] max-w-md rounded-2xl border border-line bg-surface p-8 shadow-xl">{/* ... */}</div>
</div>
```

---

## Style Guidelines

**Style:** Bento Grids
**Keywords:** Apple-style, modular, cards, organized, clean, hierarchy, grid, rounded, soft
**Best For:** Product features, dashboards, marketing summaries
**Key Effects:** Hover scale (1.02) — но primary через border/bg-shift, не shadow; content reveal; stagger on enter.

### Page Pattern (default, переопределяется в pages/)

**Pattern Name:** AI Personalization Landing
- **Conversion Strategy:** динамический hero + релевантные демо под сегмент.
- **CTA Placement:** hero (sticky в Nav) + post-testimonials/bento.
- **Section Order:** 1. Dynamic hero, 2. Relevant features (bento), 3. Tailored testimonials/метрики, 4. Smart CTA → дашборды.

---

## Motion

**Stagger List** (Standard) — Trigger: load/scroll | Duration: 300–450ms | Easing: `back.out(1.4)`

```js
// gsap, только в 'use client' компоненте-обёртке
gsap.from('.grid-item', {
  opacity: 0, scale: 0.92, y: 16, duration: 0.4,
  stagger: { each: 0.06, from: 'start', grid: 'auto' },
  ease: 'back.out(1.4)',
});
```

- ✅ `from: 'center'` для bento — eye drawn inward first.
- ❌ `back.out` на плотных data-таблицах — overshoot читается как небрежность.
- ⚡ Группировать DOM-writes; не мешать layout-reads (`getBoundingClientRect`) между tweens.

**reduced-motion (STRICT, уже в `globals.css`):** глобальное правило
`@media (prefers-reduced-motion: reduce)` обнуляет animation/transition-duration.
GSAP-стagger **обязан** проверять `window.matchMedia('(prefers-reduced-motion: reduce)')`
и пропускать анимацию — канон-правило не покрывает JS-driven motion.

---

## Anti-Patterns (STRICT — НЕ использовать)

### От движка
- ❌ **Light mode default** — канон forcedTheme="dark", light нет вообще.
- ❌ **Slow performance** — bento лёгкий, держать.

### Канон-специфичные (web/ инварианты)
- ❌ **Emojis как иконки** — только SVG через Lucide (или inline), stroke-width консистентный.
- ❌ **Хардкод hex в компонентах** — только tailwind-токены (`bg-surface`, `text-accent`).
- ❌ **Google Fonts через CDN** (`@import`/`<link>`) — сломает CSP. Только `next/font` (self-host).
- ❌ **Light/dark toggle UI** — тема одна (dark), toggle = мёртвый элемент.
- ❌ **Layout-shifting hovers** — hover через bg/border/opacity, не через width/height/shift.
- ❌ **Low contrast text** — `text-dim` на `bg-bg` = 4.6:1 (AA проходит; AAA нет — ок для secondary).
- ❌ **Instant state changes** — transition 150–300ms на всех интерактивах.
- ❌ **Invisible focus states** — `focus-visible:ring-accent` обязательно.

### Безопасность (web/ scoped override, из CLAUDE.md)
- ❌ `'use client'` на статичном контенте — Server Component по умолчанию.
- ❌ Прямой импорт `@challenge/core/*` вне `web/lib/server/challenge.ts` (server-only chokepoint).
- ❌ `NEXT_PUBLIC_*` секреты — только флаги наличия наружу.
- ❌ SQL string-interpolation (`${var}`) — только parameterized `?`.
- ❌ Taint-контент (RSS/TG/LLM) без `core/sanitize.ts` `clean()` перед БД/промптом.

---

## Pre-Delivery Checklist

Перед сдачей UI-кода проверить:

### Базовый UI
- [ ] Нет emoji как иконок (только Lucide/inline SVG)
- [ ] Иконки из одного сета, stroke-width консистентный
- [ ] `cursor-pointer` на всех кликабельных (или native `<button>`/`<a>`)
- [ ] Hover через bg/border/opacity, 150–300ms transition
- [ ] `text-ink` / `text-dim` контраст ≥ 4.5:1 (AA) — на dark-graphite уже держится
- [ ] `focus-visible:ring-accent` на всех интерактивах
- [ ] `prefers-reduced-motion` — GSAP-stagger обнуляется (JS-проверка)
- [ ] Responsive: 375 / 768 / 1024 / 1440px (bento 4→2→1 колонки)
- [ ] Нет контента за fixed Nav/Sidebar
- [ ] Нет горизонтального скролла на 375px

### web/ стек-инварианты (scoped override)
- [ ] Server Component по умолчанию; `'use client'` только для интерактивных (GSAP, cursor)
- [ ] Нет `@challenge/core/*` мимо `web/lib/server/challenge.ts`
- [ ] Шрифты только через `next/font` (self-host), **0** `@import` Google Fonts
- [ ] Цвета только через tailwind-токены (`bg-accent`, `text-ink`), **0** хардкод-hex
- [ ] После сборки: `grep -rl "telegram\|TG_SESSION\|DEEPSEEK_API_KEY" web/.next/static` → **0** совпадений
- [ ] CSP `'self'` в `next.config.ts` — не ослаблена
- [ ] Публичный доступ (если будет) — loopback + reverse-proxy/edge с auth/TLS; голый `0.0.0.0` без auth ЗАПРЕЩЁН
