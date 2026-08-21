# Landing Page Overrides — AI Dev Tool (alex-glad-challenge)

> **PROJECT:** AI Dev Tool — личный продающий лендинг владельца challenge (landing-v2)
> **Page Type:** Personal marketing landing (`/`, публичный; routing-решение day-35: `/` = лендинг)
> **Создан:** 2026-07-20 · **Переписан:** landing-v2 (день 36 → v2, направление D1 «Бродсайд»)

> ⚠️ **IMPORTANT:** Правила здесь **переопределяют** `MASTER.md`.
> Только отклонения от Master. Остальное — из Master.

---

## Контекст страницы

Цель лендинга v2 — **подписка на Telegram-канал** (единственная макро-конверсия).
Продукты и челлендж — доказательство, не цель клика. Направление: **D1 «Инженерный
бродсайд»** — типографический плакат-«передовица»: гигантский mono-заголовок-оффер,
воздух, hairline-линейки-разделители, нумерация «глав» 01/02/03. Ноль декоративных
фонов; единственный glow — radial-teal-пятно за финальной CTA-панелью (заимствование
из D3, единственное). Маршрут `/` — публичный (admin-auth day 36: `/` и `/login` —
исключения в middleware `PUBLIC_PATHS`).

**Контент:** единственный источник — `web/data/landing.ts` (v2): `offerVariants`
A/B/C + активный `offer`, `offerMeta.metaDescription`, `person` (имя-плейсхолдер),
`channel` (url/handle/label — плейсхолдеры), `challengeNarrative`, `proofMetrics`
(доминанта 36 + 3 вторичных), `milestones` (4), `artifacts` (6, products+core слиты,
`tag` — человекочитаемый, НЕ маршрут), `stackLine`, `channelPoints`, `contactLinks`.
Числа — завершённый срез челленджа: **36 / 10+ / 7 / 82**. Tailwind-литералы — только
в `app/page.tsx` и компонентах (JIT-детект), в data-файле — только данные.

**Контейнерами владеет страница** (landing-v2): гостевая ветка root layout —
`<main className="flex-1">` БЕЗ контейнера; каждая секция сама несёт full-width
`<section>` + внутренний `mx-auto w-full max-w-6xl px-5`. Админ-ветка layout не
трогается: админ видит `/` в каркасе 1152px — секции D1 деградируют корректно
(full-bleed-линейки обрезаются контейнером — принято осознанно).

---

## Роли страницы: гость vs админ (KEY)

| Элемент | Гость (нет сессии) | Админ (cookie admin_session) |
|---|---|---|
| Primary-CTA «Подписаться на канал» | внешний `channel.url` (t.me), `target="_blank" rel="noopener noreferrer"` | тот же внешний t.me-CTA (единый для обеих ролей) |
| Secondary-CTA hero | «Смотреть, что построено ↓» → якорь `#proof` (НЕ логин) | + ghost «В дашборд →» (`/dashboard`) |
| Карточки-артефакты (S3) | `<article>` БЕЗ href — карточка-доказательство, без стрелки | `<Link>` на live-маршрут (стрелка «→», focus-ring) |
| Строка «Полный обзор — /showcase» (S3) | НЕ показывается | показывается |

Инвариант: гость не попадает в login-стену кликами по лендингу. Все конверсионные
CTA — только через `web/app/components/landing/SubscribeButton.tsx` (primary/inline).

---

## Section Order (override: 4 секции, hero-оффер → финальный CTA)

| # | Секция | id | Контент |
|---|--------|----|---------|
| 1 | **Hero** (оффер) | — | Лейбл `имя · роль · 36 дней челленджа` (SectionLabel, имя — подстрока, НЕ H1); H1 = `offer.headline` mono uppercase `clamp(2rem,6.5vw,4.5rem)` вес **600** `leading-[0.95]`; subhead `max-w-xl text-dim`; CTA-ряд (primary внешний + `#proof` + admin-ghost); под кнопками mono xs `t.me/<handle>` |
| 2 | **Proof** | `proof` | Нарратив 2–3 предложения; метрики: доминанта `36` (`text-7xl/8xl` tabular-nums **ink**, НЕ teal) + 3 вторичных в ряд; 4 вехи-«лог-строки» (`border-t border-line py-4`, mono-диапазон слева); inline-CTA «→ Подписаться на канал» |
| 3 | **Артефакты** | — | 6 BentoCard (`grid-cols-1 sm:grid-cols-2 md:grid-cols-3`), badge = `tag` (человекочитаемый), teal-иконка = единственная teal-деталь карточки; `stackLine` одной mono-строкой; `/showcase` — только админ |
| 4 | **Финальный CTA** | — | Glow-панель (FinalCta): заголовок «Что будет в канале» + 3 пункта `channelPoints` + большая primary-кнопка + `t.me/<handle>`; ниже панели — плоская mono-строка контактов (`contactLinks`, НЕ карточки) |

Touchpoints конверсии: hero-кнопка + inline-ссылка после S2 + финальная кнопка = 3.
Ритм секций: `py-16 md:py-24` + `border-t border-line` (кроме hero). Тон = факты
и числа, RU. Анти-дублирование: `/` — «зачем подписаться», `/showcase` — «что
внутри» (админ), `/dashboard` — «что живо» (админ).

---

## Layout / Typography Overrides

- Контейнер секций — `mx-auto w-full max-w-6xl px-5` (владеет страница/SectionShell).
- Hero-H1 — `font-mono font-semibold uppercase text-[clamp(2rem,6.5vw,4.5rem)]
  leading-[0.95] tracking-tight`; вес 600 реально загружен в next/font
  (`layout.tsx`, plexMono `['400','500','600']`) — faux-bold запрещён.
- Метрики: `tabular-nums`, числа **ink** (teal-дисциплина: teal = только CTA
  и иконка карточки-артефакта).
- Секции с `id` (`proof`) — `scroll-mt-20` (компенсация sticky header h-12).
- Вехи — «лог-строки» (border-t + mono-диапазон), НЕ карточки.

## Color Overrides

- Палитра — канон Graphite+Teal из MASTER, БЕЗ переопределений.
- Единственный glow на странице: `bg-accent/10 blur-3xl` radial-пятно за финальной
  CTA-панелью (`FinalCta`, `pointer-events-none`). Больше нигде.

## Motion Overrides

- CSS-stagger `.bento-enter` (hero, строки 0..4) + scroll-reveal `.l-reveal`
  (обёртки S2–S4, CSS-only `animation-timeline: view()` под
  `@supports`, `globals.css`). Нового JS-motion — 0.
- Фолбэк `.l-reveal` (Firefox и др.): контент просто статично виден.
- `prefers-reduced-motion` гасит всё (глобальный блок globals.css).

## Component Overrides

- **BentoCard:** без изменений (`href?: string` — см. таблицу ролей).
- **SubscribeButton** (`components/landing/`): primary = внешний accent-кнопка
  min-h-[44px] + IconTelegram + focus-ring; inline = mono teal-ссылка «→ …».
  Единственная реализация конверсионного действия.
- **SectionShell** (`components/landing/`): full-width секция-«глава» + контейнер
  + SectionLabel `NN · label`.
- **FinalCta** (`components/landing/`): glow-панель финальной конверсии.
- **Иконки:** `LandingIconId → icons.tsx` — 8 шт., включая `IconTelegram`
  (Lucide send-horizontal; новых сверх этого не добавлять).
- Внешние ссылки: `rel="noopener noreferrer"`; mailto — без `target`.
- Все новые компоненты лендинга — Server Components, `'use client'` — 0.

## Metadata

- Page-local metadata `/`: title `${person.name} — ${person.role}`, description =
  `offerMeta.metaDescription` (тон подписки, число 36). Layout-description —
  генеральный fallback (без устаревшего счётчика дней).
- openGraph отложен до публичного домена (нет metadataBase/OG-изображений —
  build-warning + CSP).

---

## Плейсхолдер-гейт запуска (данные пользователя, отдельно от кода)

Код-merge возможен и до проставки; публичный запуск — НЕТ. Блокеры запуска:

1. `person.name` — реальное имя (лейбл hero + metadata title).
2. `channel.url` / `channel.handle` — реальный URL канала (CTA ведёт на плейсхолдер).
3. `channelPoints` — редакционная формула канала (черновик в данных).
4. `contactLinks` — состав/значения (email? github? — приватный репо → 404 для гостя).
5. Публичный доступ `/` наружу домена — инфраструктурная задача (исключение `/` и
   `/login` из basic-auth прокси), НЕ решается кодом лендинга.
