# Landing Page Overrides — AI Dev Tool (alex-glad-challenge)

> **PROJECT:** AI Dev Tool — лендинг стэка (локальные LLM-агенты, RAG, MCP, TG-автоматизация)
> **Page Type:** Marketing landing → переходы на дашборды (`/dashboard`, `/joker`, `/ask`, `/chat`)
> **Создан:** 2026-07-20

> ⚠️ **IMPORTANT:** Правила здесь **переопределяют** `MASTER.md`.
> Только отклонения от Master. Остальное — из Master.

---

## Контекст страницы

Цель лендинга: презентовать стэк alex-glad-challenge как **product-grade AI/dev tool** и
провести посетителя в конкретный работающий дашборд (не «общая информация», а live-демо).

**Вписка в каркас `web/`:** лендинг рендерится внутри существующего layout
(`Nav` + `Sidebar` + `<main max-w-6xl>` + `Footer`). Не переопределять корневой layout —
собирать из секций внутри main. См. `web/app/layout.tsx`.

**Маршрут:** уточнить при реализации (вероятно `/` — текущий `app/page.tsx`, или новый `/landing`).
Это решение Research/Plan стадии профиля «Бизнес-фича», НЕ дизайн-решение.

---

## Section Order (override: AI Personalization Landing → под стэк)

| # | Секция | Контент | CTA |
|---|--------|---------|-----|
| 1 | **Hero** | Headline (mono, uppercase): локальные LLM-агенты + RAG + MCP. Sub: TG-автоматизация. 2 кнопки. | primary `Открыть dashboard` → `/dashboard`; secondary `Смотреть демо` → `/joker` |
| 2 | **Bento: модули** | 6–8 плиток реальных демо (см. ниже) | каждая плитка = ссылка в свой дашборд |
| 3 | **Bento: ядро** | 2×2 плитки архитектуры: RAG pipeline, MCP round-trip, LLM-gateway, TG MTProto | ссылки на docs/исходники |
| 4 | **Метрики** | Stagger числа: дней челленджа, MCP-серверов in-repo, LLM-провайдеров, дней с локальной моделью | — |
| 5 | **Smart CTA** | Финальный блок: «Выбрать свой entry-point» — карточки-линки на 4 dashboard | `dashboard` / `joker` / `ask` / `chat` |

---

## Bento: модули (секция 2) — конкретные плитки

Каждая плитка = `<a href="...">` обёрнутая в Bento Card (см. MASTER). Real content, не lorem.

| Tile (span) | Заголовок | Контент | Ссылка |
|---|---|---|---|
| 2×1 (широкая) | **RAG-движок** | local-embed → rerank → цитаты; guard «не знаю». Ollama native client. | `/chat` (rag chat) |
| 1×1 | **/joker** | CINE-PUN чат; локальная qwen3.5:4b; факты 8с + shuffle. | `/joker` |
| 1×1 | **/ask** | Dev-assistant: README+docs RAG, cloud-Claude draft. | `/ask` |
| 2×1 (широкая) | **MCP round-trip** | Свои MCP-серверы (crm, files); deterministic, no LLM-loop. | `/files` |
| 1×1 | **/support** | CRM users/tickets + faq RAG. | `/support` |
| 1×1 | **/pr-review** | GitHub Action: diff → cloud Claude → PR-комментарий. | docs / GH |
| 2×1 (широкая) | **TG-автоматизация** | MTProto userbot; RSS sports.ru/championat/bbc. | `/blog/scout` |

Порядок и span — переставить в Plan-стадии под actual наполнение. Не плодить пустые плитки: **лучше 4 реальные, чем 8 с lorem**.

---

## Layout Overrides

- **Max Width:** `max-w-6xl` (72rem) — канон main уже даёт; не переопределять.
- **Layout:** full-width sections внутри main, контент centered. Hero может вырваться за `max-w-6xl` через отрицательные маржины или отдельную section-обёртку — решение Plan-стадии.
- **Sidebar:** на лендинге может скрываться (`hidden md:block` или убрать) — лендинг обычно full-width без боковой нав. **Решение Plan-стадии** (не дизайн).
- **Bento grid:** `grid grid-cols-1 md:grid-cols-4 gap-4 md:gap-6 auto-rows-[minmax(180px,auto)] md:auto-rows-[200px]`. Mobile 1 колонка, tablet 2, desktop 4.

## Color Overrides

- **Не переопределять** — брать канон Graphite+Teal из MASTER.
- Hero фон: `bg-bg` + опционально teal-glow радиалкой (`radial-gradient` teal/5%) — decorative, не функциональный цвет.
- Smart-CTA блок (секция 5): `bg-surface` + teal-акцент на карточках (активный = teal-border).

## Typography Overrides

- **Hero headline:** `font-mono text-4xl md:text-6xl font-semibold uppercase tracking-tight text-ink` — mono-ритм как у существующих pages (`/dashboard`, `/chat`).
- **Метрики числа:** `font-mono text-4xl text-accent` (teal, tabular figures).
- Остальное — из MASTER type scale.

## Motion Overrides

- **Hero:** fade-up sub+headline (200ms), кнопки появляются на 100ms позже.
- **Bento секции 2-3:** Stagger List из MASTER (`back.out(1.4)`, each 0.06, from 'center').
- **Метрики:** stagger + опционально count-up (только если `motion-safe`; reduced-motion → сразу финальное число).
- **card hover:** `border-line-strong` + `bg-surface-2`, 200ms ease-out. **Без** scale-transform (layout-shift антипаттерн) — hover scale (1.02) из движка **отклонён** для bento-карточек со ссылками (читается как дрожание при наведении на сетку).

---

## Component Overrides

- **Bento Card как `<a>`:** вся плитка кликабельна → `cursor-pointer`, `focus-visible:ring-accent`, `aria-label` с названием модуля. Tile = одна navigation-цель, не плодить внутренние ссылки.
- **Иконки:** Lucide на tile-header (16×16, teal). Один сет на весь лендинг.
- **Числа-метрики:** `font-mono` + `tabular-nums` (Tailwind `tabular-nums`) — чтобы не прыгали при count-up.

---

## Recommendations (content-level)

- ✅ Real data в плитках: реальные названия модулей (`/joker`, `/ask` и т.д.), реальные ссылки.
- ✅ Чётко помечать что локальное (Ollama/qwen) vs cloud (OpenRouter/Claude) — dev-tool прозрачность.
- ✅ Метрики — точные (дней в registry, MCP-сёрверов в `core/mcp*`).
- ❌ Avoid: static «обобщённое AI» без конкретики.
- ❌ Avoid: present AI as human (нет «наш AI-ассистент поможет» — есть «qwen3.5:4b генерит cinepun»).
- ❌ Avoid: lorem ipsum, заглушки-фишки без реализации.

---

## Открытые вопросы (на Research/Plan стадию)

1. **Маршрут лендинга:** `/` (перезаписать текущий `app/page.tsx`) или новый `/landing`?
2. **Sidebar на лендинге:** скрыть или оставить?
3. **Метрики:** точные числа — снять с `registry.ts` / `git log --oneline | wc -l` / `core/mcp*` count на стадии Plan.
4. **Аналитика для personalization** (паттерн требует): НЕТ в каноне (privacy, loopback-only). Personalization-сегмент заменить на **один универсальный hero** без аналитики. Зафиксировать как отклонение от паттерна.
