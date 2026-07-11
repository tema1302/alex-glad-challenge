# web/ — полный редизайн в регистре PRODUCT (палитра C «Graphite + Teal»)

**Дата:** 2026-07-11
**Ветка:** `day-30`
**Surface:** `web/` (scoped override, день 28) — локальный Next.js 15 App Router + React 19 + Tailwind **v3**.
**Регистр:** PRODUCT (design SERVES the product).

---

## 1. Контекст и цель

`web/` — локальный (127.0.0.1) AI-workbench одного пользователя (Артемия): RAG, chat-агент, blog-pipeline, Telegram-автоматизация, MCP, сводки. 23 страницы, 31 Route Handler, dense, data-heavy, dark-only.

Сейчас сосуществуют два визуальных регистра:
- **Matrix-default** (22 страницы): фосфор `#00ff66` на green-void `#040806`, моно везде, glow/scanlines, `.neon-border`, `MatrixRain` (демонтирован, orphan), `ThemeToggle` переключает несуществующий дождь.
- **Machine-nameplate** (только `/`): amber-on-ink, orchestrated `ai-sweep` load-motion.

Оба регистра — brand-y, с decorative-noise (glow, scanlines, neon, page-load motion), что противоречит PRODUCT-дисциплине. Редизайн унифицирует все 23 страницы в один спокойный PRODUCT-язык и сносит decorative-noise + мёртвый код.

**Цель:** единый dense power-tool UI, палитра C, моно-heading идентичность, без page-load motion, чистый от orphans.

## 2. Решения (зафиксированы с пользователем)

| Решение | Выбор |
|---|---|
| Регистр | **PRODUCT** |
| Палитра | **C — Cool graphite + Teal** |
| Типографика | **B1 — Mono heading**: H1/labels IBM Plex Mono uppercase; body IBM Plex Sans (кириллица); data IBM Plex Mono |
| Тема | **Dark-only** (forcedTheme dark, как сейчас) |
| Плотность | **Dense power-tool** |
| Навигация | **N3 — Hybrid**: top header (brand + 3 core) + left sidebar (полный nav по группам) |
| Orphans | Удалить `MatrixRain.tsx`, удалить `ThemeToggle.tsx`; починить палитру `error.tsx` и `global-error.tsx` |

## 3. Goals / Non-goals

**Goals**
- Унифицировать визуальный язык 23 страниц под PRODUCT-палитру C.
- Снести decorative-noise (glow, scanlines, neon, gradient-text, page-load motion, MatrixRain).
- Ввести N3 hybrid-навигацию (header + sidebar) на единой оболочке.
- Перевести типографику на IBM Plex (Sans body / Mono headings+data), чтобы уйти от overused Inter (флаг impeccable) и дать интерфейсу личность.
- Починить orphan/аномалии: `MatrixRain.tsx`, `ThemeToggle.tsx`, `error.tsx` (красная палитра), `global-error.tsx` (inline вне C).
- Соблюсти a11y-спайн: контраст, focus-visible, reduced-motion, «не цветом единым», семантический HTML.

**Non-goals**
- НЕ трогать `web/lib/server/*`, `web/lib/shared/*`, `web/app/api/*` (31 route), содержимое `web/data/*`, БД, `@challenge/core/*`.
- НЕ добавлять light-тему (dark-only).
- НЕ менять IA контента (роуты, структура `data/nav.ts` переиспользуется как есть).
- НЕ добавлять build/lint/unit (не настроены по инвариантам стека).
- НЕ править README-расхождения (forcedTheme dark vs заявленный «dark/light»; отсутствие `loading.tsx`) — отдельно, не в этом дизайне.
- НЕ перетрясать server-логику (SSE, MTProto, индексация).

## 4. Стек-факты (из река)

- Tailwind **v3.4.17** (`@tailwind base/components/utilities`; CSS-вары в `:root` в формате `R G B` для alpha-modifier; `darkMode:'class'`).
- Next.js 15.1.6 App Router, React 19, `next-themes` 0.4.4 (`forcedTheme="dark"`), zod 3.24.
- **next/font НЕ подключён** (все шрифты — системные стеки). Редизайн вводит `next/font/google` для IBM Plex Sans + Mono.
- `node:sqlite` (WAL), server-only chokepoint `web/lib/server/challenge.ts`, bind 127.0.0.1, CSP `default-src 'self'; script-src 'self'; connect-src 'self'`.
- Шага production-build нет (только `dev` и `typecheck`).

## 5. Дизайн-токены

### 5.1 Палитра (primitive, `:root`, формат `R G B`)

| Токен | Значение (RGB triple / hex) | Роль |
|---|---|---|
| `--bg` | `15 20 23` / `#0F1417` | page background |
| `--surface` | `22 29 33` / `#161D21` | cards/tiles raised |
| `--surface-2` | `27 36 41` / `#1B2429` | hover / inset |
| `--border` | `35 44 49` / `#232C31` | hairline (декоративный разделитель) |
| `--border-strong` | `48 60 66` / `#303C42` | интерактивные границы (≥3:1) |
| `--text` | `220 227 232` / `#DCE3E8` | body text |
| `--dim` | `138 151 158` / `#8A979E` | secondary / labels |
| `--accent` | `63 184 175` / `#3FB8AF` | teal — единственный accent, ≤10% площади |
| `--accent-ink` | `10 16 18` / `#0A1012` | текст на teal-заливке |
| `--ok` | `63 184 175` / `#3FB8AF` | статус OK (намеренно = `--accent`; OK-семантика и есть accent) |
| `--warn` | `224 162 60` / `#E0A23C` | amber — семантика warn (не accent) |
| `--err` | `224 86 86` / `#E05656` | red — семантика error |

### 5.2 Контраст (a11y-проверка)

- body `--text` на `--bg`: ~14:1 ✓ (≥4.5).
- `--dim` на `--bg`: ~5.8:1 ✓ (≥4.5; годится для secondary/labels).
- `--accent` (teal) как текст на `--bg`: ~7.6:1 ✓.
- primary button: `--accent` заливка + `--accent-ink` текст ~7.6:1 ✓.
- `--border` hairline < 3:1 — допустимо для декоративных разделителей; для **смысловых** границ (input/button/active-link) использовать `--border-strong` (≥3:1).

### 5.3 Снос старых токенов и utilities

Удалить из `tailwind.config.ts` и `globals.css`:
- Все `--mx-*` (void/void-deep/surface/surface-2/green/green-bright/cyan/magenta/amber/red/text/text-dim/border/border-glow).
- Все `--ai-*` (ink/panel/line/bone/dim/amber/teal).
- Color namespaces `matrix.*`, `land.*`, старый `neutral.*` (green-tinted) и `accent`/`accent.soft` (green/cyan) — заменить на C-палитру.
- `boxShadow`: `glow`, `glow-cyan`, `glow-magenta`, `inset-glow`.
- `keyframes`/`animation`: `marquee` (и `ai-sweep`, `ai-carrier` из globals).
- Utilities: `.text-glow*`, `.scanlines`, `.glass`, `.neon-border`, `.gradient-neon`, `.ai-sweep`, `.ai-carrier`, `.active-nav` (заменить на C-эквивалент).

Оставить: глобальный `@media (prefers-reduced-motion: reduce)` override.

## 6. Типографика

- **Body:** IBM Plex Sans (через `next/font/google`, subset `cyrillic,latin`, `display:swap`) + system fallback (`system-ui, -apple-system, 'Segoe UI', sans-serif`). Weight 400/500/600.
- **Headings (H1, section-labels, group-titles):** IBM Plex Mono, uppercase, tracking `0.06–0.1em`, weight 500/600.
- **Data (числа, id, paths, code):** IBM Plex Mono.
- **Размерная шкала (dense):**
  - `xs` 11px / `sm` 12.5 / `base` 13.5 / `md` 15 / `lg` 18 / `xl` 22 / `2xl` 28.
  - Body base 13.5px.
- Запрет: gradient-text, text-glow, text-clip на заголовках.

**Реализация шрифта (примечание для плана):** next/font в v3 — стандартный паттерн с CSS-variable (`font-sans`/`font-mono` variables на `<html>` или `<body>`, маппинг в `tailwind.config.ts` `fontFamily.sans/mono`). Конкретная разводка (variable имена, fallback-цепочки, subset) — на стадии plan.

## 7. Layout / Nav (N3 hybrid)

```
┌───────────────────────────────────────────────────────────┐
│ HEADER (sticky): brand «Артемий» · core(Главная/Dash/Витрина) · model-status │
├────────────┬─────────────────────────────────────────────┤
│ SIDEBAR    │  MAIN (max-w-6xl, px-5 py-6, dense rhythm)   │
│ w-56       │                                              │
│ core       │   <h1 mono uppercase>                        │
│ rag   ▾    │   // section label                           │
│  rag       │   [tiles/cards/table/form/...]               │
│  chat      │                                              │
│  ...       │                                              │
│ blog  ▾    │                                              │
│ mcp   ▾    │                                              │
│ sys   ▾    │                                              │
├────────────┴─────────────────────────────────────────────┤
│ FOOTER (compact one-row, mirror nav, dim)                 │
└───────────────────────────────────────────────────────────┘
```

- **Header:** sticky top, `border-b border-border`. Brand моно. Core-links inline (3). Справа — активная модель (`--ok` dot teal + имя, без значений ключей).
- **Sidebar:** `position: sticky; top: <header-height>`; `w-56`, groups из `data/nav.ts` (7 групп: core/rag/chat/tg/blog/mcp/sys). Каждая группа — `<details>` collapsible (по умолчанию раскрыта для active-группы, остальные collapse на mobile, на desktop открыты). Active-link: `bg-surface-2` + `text-accent` + left `2px solid accent` bar.
- **Main:** `max-w-6xl mx-auto`, `px-5 py-6`, dense vertical rhythm (`gap-3`/`gap-4`).
- **Footer:** compact one-row, mirror nav из `data/nav.ts`, `text-dim hover:text-text`.

## 8. Компоненты (dense)

| Компонент | Спека |
|---|---|
| **Tile/Stat** | `bg-surface border border-border rounded-md px-3 py-2`; label `text-xs dim font-mono uppercase`; value `text-lg font-mono` |
| **Card** | `bg-surface border rounded-md p-4`; section-label `// ...` (`text-xs dim font-mono uppercase`) сверху |
| **Button primary** | `bg-accent text-accent-ink rounded-md px-3 py-1.5 text-sm font-medium hover:brightness-110` |
| **Button ghost** | `border border-border-strong text-dim hover:text-text rounded-md px-3 py-1.5` |
| **Button danger** | `border border-err/60 text-err hover:bg-err/10 rounded-md` (без заливки по умолчанию) |
| **Button height** | dense 32px; CTA ≥40px |
| **Table** | hairline rows (`border-border`); `th` mono uppercase dim; `td` body; hover row `bg-surface-2` |
| **Input/textarea/select** | `bg-surface-2 border border-border-strong rounded-md px-2 py-1.5 text-sm`; focus `ring-1 ring-accent outline-none` |
| **Badge/status** | dot + текст: `● ok`(teal) / `● warn`(amber) / `● err`(red) / `● off`(dim) |
| **Code block** | `bg-[#0B0F12] border rounded-md p-3 font-mono text-dim text-sm` |
| **Live/SSE** | small CSS spinner (mono-geom, без glow); progress bar `h-1 bg-surface-2` с `bg-accent` fill |
| **Chat message** | role-label `font-mono uppercase text-xs dim`; body `text-text`; assistant `bg-surface`, user `bg-surface-2`. **Без side-tab** (finding impeccable). |

## 9. Motion-политика (PRODUCT)

- **NO page-load orchestration.** Снести `ai-sweep`, `ai-carrier`, `marquee`, `MatrixRain`, все decorative keyframes.
- Разрешено: hover/focus transitions (`duration-150`), SSE spinner, progress bars, native `<details>` collapse, opt-in typing-cursor в chat REPL.
- `prefers-reduced-motion: reduce` → spinner static, transitions ~0ms (существующий глобальный override оставить).

## 10. A11y-спайн

- Контраст: body/dim ≥4.5:1 (проходит), смысловые границы ≥3:1 (`--border-strong`).
- «Не цветом единым»: статус = dot + текст; chart-серия = bar + value-label (не только цвет).
- `focus-visible:ring-1 ring-accent outline-none` на всех интерактивах.
- Семантический HTML: `header/nav/main/aside/footer/table/details`.
- ARIA на collapsible-группах sidebar.
- Touch target: CTA ≥40px; dense-кнопки 32px (desktop localhost, не mobile-first — **риск**, зафиксирован; если позже нужен mobile, поднимаем до 44px).

## 11. Orphan-чистка

- Удалить файлы: `app/components/MatrixRain.tsx`, `app/components/ThemeToggle.tsx`.
- Убрать импорт/рендер `ThemeToggle` из `app/components/Nav.tsx`; убрать комментарий про демонтаж MatrixRain из `app/layout.tsx`.
- `app/error.tsx`: красную палитру (`red-50/300/700`, `dark:red-950/900/300`) → C-палитра + `--err` для семантики ошибки.
- `app/global-error.tsx`: сейчас inline-стили `system-ui` вне Tailwind-дерева. Оставить inline (Boundary не грузит Tailwind), но покрасить под C (`--bg`/`--text`/`--err` hex напрямую).

## 12. Миграция страниц (23)

Единая оболочка (header + sidebar + footer) через root `app/layout.tsx`. Контент страниц — 5 архетипов:

| Архетип | Страницы |
|---|---|
| **Landing** | `/` (hero tiles с live-счётчиками из БД, capability-grid, 30-day chart bar+label, process-ledger; без orchestrated motion) |
| **Dashboard** | `/dashboard` (stat-grid: news/posts/style/RAG/TG/dialog + keys-status Boolean + active-model) |
| **Data-list** | `/blog/posts`, `/rag/chats`, `/chat`, `/mcp/tools`, `/admin/servers` |
| **Form/REPL** | `/rag`, `/rag/chat/[id]`, `/chat/[id]`, `/blog/news`, `/blog/pipeline`, `/blog/scout`, `/tg/collect`, `/telegram/publish`, `/mcp/call`, `/agent`, `/rag/index`, `/rag/index-tg`, `/settings` |
| **Read-only brief** | `/briefing`, `/summary`, `/tg/top`, `/showcase` |

Структурно страницы не перестраиваются — заменяются классы/палитра/шрифты, header+sidebar делегируются в layout. `data/nav.ts`, `data/landing.ts`, `data/showcase.ts` — контент переиспользуется.

## 13. File-impact

**Правка:**
- `web/tailwind.config.ts` — палитра, fontFamily (Plex), снос glow/marquee/land/matrix.
- `web/app/globals.css` — `:root` токены C, снос utilities/keyframes, base-стили.
- `web/app/layout.tsx` — next/font подключение, header+sidebar+footer оболочка, снос комментария MatrixRain.
- `web/app/components/Nav.tsx` — переделать в header (brand + core + model-status), убрать ThemeToggle.
- `web/app/components/Footer.tsx` — compact C-стиль.
- `web/app/error.tsx`, `web/app/global-error.tsx` — C-палитра.
- 23 × `page.tsx` — проход: заменить классы/палитру/шрифты под архетип.

**Новые:**
- `web/app/components/Sidebar.tsx` — groups из `data/nav.ts`, `<details>`, active-link.
- (Возможно) `web/app/components/ui/*` — если выделяем переиспользуемые Tile/Card/Button; состав определяется на стадии plan.

**Снос:**
- `web/app/components/MatrixRain.tsx`, `web/app/components/ThemeToggle.tsx`.

## 14. Критерии приёмки

- Все 23 страницы визуально едины (палитра C, Plex, header+sidebar+footer).
- Ни на одной странице нет: green-phosphor, glow, scanlines, neon-border, gradient-text, page-load motion, MatrixRain-артефактов.
- `ThemeToggle`/`MatrixRain` файлов нет; ссылок на них в коде нет.
- `error.tsx`/`global-error.tsx` в C-палитре.
- typecheck зелёный: `pnpm --filter web typecheck` (или эквивалент workspace).
- A11y-спайн: body/dim ≥4.5:1, focus-visible на интерактивах, статус не только цветом, reduced-motion работает.
- Семантика: ключи/сессии не утекают (server-only chokepoint целостен; grep `telegram|TG_SESSION|DEEPSEEK_API_KEY` по `web/.next/static` → 0).
- Репо-инварианты в силе: bind 127.0.0.1, CSP, no `NEXT_PUBLIC_*` секретов, SQL parameterized.

## 15. Риски / допущения

- **next/font + Plex:** первый `dev` запуск скачает шрифты (нужна сеть один раз, далее кэш в `.next`). Если оффлайн — fallback на system stack (Plex Mono → ui-monospace/JetBrains; Plex Sans → system-ui/Inter). Допущение: среда имеет доступ к Google Fonts при первом пуске.
- **Tailwind v3 vs v4:** дизайн написан под v3 (фактический стек). `@theme inline`-паттерны (v4) НЕ применяются. Если позже миграция на v4 — отдельная задача.
- **Touch-target 32px:** desktop-localhost допущение; mobile-сценарий потребует 44px.
- **Sidebar collapsible:** на desktop группы открыты; collapse-логика через `<details>` (native, без JS-state).
- **Landing `/` теряет brand-motion:** `ai-sweep` убирается; лендинг становится product-spокойным. Это сознательное решение (PRODUCT-регистр).
- **Объём (23 страницы):** проход по всем `page.tsx` — большой, но механический (заменить классы). Делается пакетно по архетипам на стадии implementation.
