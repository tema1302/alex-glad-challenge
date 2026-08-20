# Landing Page Overrides — AI Dev Tool (alex-glad-challenge)

> **PROJECT:** AI Dev Tool — личный продающий лендинг владельца challenge (день 36)
> **Page Type:** Personal marketing landing (`/`, публичный; routing-решение day-35: `/` = лендинг)
> **Создан:** 2026-07-20 · **Переписан:** день 36 (products-лендинг → личный)

> ⚠️ **IMPORTANT:** Правила здесь **переопределяют** `MASTER.md`.
> Только отклонения от Master. Остальное — из Master.

---

## Контекст страницы

Цель лендинга: продать **человека**, а не стэк. Главный продающий актив — сам челлендж
(35 дней подряд, каждая подсистема доведена до работающего состояния). Продукты day-35
(RAG, joker, MCP, TG, blog, dialog memory) переезжают в секцию proof в новой рамке
«построено», а не «live». Маршрут `/` — единственный публичный (день 36: admin-auth на
весь app, `/` и `/login` — исключения в middleware `PUBLIC_PATHS`).

**Контент:** единственный источник — `web/data/landing.ts` (имя-плейсхолдер, нарратив,
вехи, метрики, продукты, core, стек, принципы, контакты-плейсхолдеры). Числа — ручной
срез (дрейф 35 → 36+ правится в data-файле). Tailwind-литералы — в `app/page.tsx`.

**Вписка в каркас `web/`:** рендерится внутри root layout. Хром условный (день 36):
гость — Nav без core-ссылок/статуса модели + «Войти», БЕЗ Sidebar/Footer; админ — полный
каркас + «Выйти». Решение — в `web/app/layout.tsx`, НЕ на странице.

---

## Роли страницы: гость vs админ (KEY, день 36)

| Элемент | Гость (нет сессии) | Админ (cookie admin_session) |
|---|---|---|
| proof-карточки продуктов (S3) | `<article>` БЕЗ href — карточка-доказательство, badge-маршрут как артефакт | `<Link>` на live-маршрут (стрелка «→», focus-ring) |
| Hero-CTA | primary «Связаться» → `#contacts`; secondary «Смотреть работы ↓» → `#proof` (якоря, НЕ логин) | + ghost «В дашборд →» |
| Строка «Полный обзор — /showcase» (S4) | НЕ показывается | показывается |

Инвариант: гость не должен попадать в login-стену кликами по лендингу. Primary-CTA —
контакт, не «Войти». BentoCard: `href` опционален (`web/app/components/ui/BentoCard.tsx`).

---

## Section Order (override: 5 секций, hero-личность → контакты)

| # | Секция | id | Контент |
|---|--------|----|---------|
| 1 | **Hero** (личность) | — | SectionLabel `ai-инженер · 35 дней челленджа`; H1 mono uppercase = имя; позиционирование; intro 2–3 предложения; 2–3 CTA (см. таблицу ролей) |
| 2 | **Proof-of-work** | `proof` | Нарратив челленджа; 6 карточек-вех (grid 1/2, mono-диапазон дней + название + 1 строка); 4 метрики-плитки; mono-футноут (партиции · коммиты) |
| 3 | **Продукты** | — | 6 BentoCard (тексты day-35); SectionLabel `продукты · построено` |
| 4 | **Навыки/стек** | — | 2×2 core-карточки (Card + `core` label); mono-строка стека; mono-строка принципов; `/showcase` — только админ |
| 5 | **Контакты** | `contacts` | 3 карточки (label mono + value-ссылка, `rel="noopener noreferrer"`). Плейсхолдеры — без формы обратной связи |

Тон = факты и числа, RU. Анти-дублирование: `/` — «кто и что умеет», `/showcase` — «что
внутри» (админ), `/dashboard` — «что живо» (админ). Лендинг переупаковывает, не копипастит.

---

## Layout Overrides

- **Max Width:** `max-w-6xl` (канон main) — не переопределять.
- **Sidebar на лендинге — РЕШЕНО (день 36):** гостю НЕ рендерится (вместе с Footer) —
  оба светят все 23 защищённых маршрута → login-стена на каждом клике. Управляет
  root layout по `isAdminAuthed()`, не классами на странице.
- **Grid продуктов:** `grid-cols-1 sm:grid-cols-2 md:grid-cols-3` (6 плиток). Вехи:
  `grid-cols-1 sm:grid-cols-2`. Метрики: `grid-cols-2 sm:grid-cols-4`. Контакты:
  `grid-cols-1 sm:grid-cols-3`.
- **Anchor-CTA:** секции с `id` (`proof`, `contacts`) получают `scroll-mt-20`
  (компенсация sticky header h-12).

## Color / Typography Overrides

- Палитра — канон Graphite+Teal из MASTER, БЕЗ переопределений.
- Hero H1: mono uppercase (как day-35), имя-плейсхолдер из data-файла.
- Метрики: `font-mono text-4xl tabular-nums text-accent`.
- Остальное — type scale MASTER.

## Motion Overrides

- Только CSS-stagger `.bento-enter` (глобальный, `globals.css`). Нового JS-motion — 0.
- Card hover: `border-line-strong` + `bg-surface-2`, 200ms. Без transform.
- Гостевые proof-карточки: hover остаётся мягким (без стрелки/`group`).

## Component Overrides

- **BentoCard:** `href?: string` — см. таблицу ролей. Иконки — маппинг
  `LandingIconId → icons.tsx` (7 существующих, новых НЕ добавлять).
- Контакты: внешние ссылки с `rel="noopener noreferrer"`; mailto — без target.

---

## Открытые вопросы (day 36 → пользователю, не блокаторы)

1. Реальные имя/тайтл (плейсхолдер «АРТЕМИЙ») + metadata description.
2. Реальные контакты (email/TG/GitHub) — правка `web/data/landing.ts`.
3. Фиксировать ли «35 дней» или поддерживать числа актуальными (ручная правка).
4. Публичный доступ `/` наружу домена — инфраструктурная задача (исключение `/` и
   `/login` из basic-auth прокси), НЕ решается кодом лендинга.
