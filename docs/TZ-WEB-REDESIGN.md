# ТЗ: Переделка веб-сайта `web/` — дизайн-качество + админский постинг в Telegram

| Поле | Значение |
| --- | --- |
| Статус | Утверждено к исполнению |
| Дата | 2026-09-07 |
| Объект | `web/` (Next.js 15 App Router, React 19, Tailwind 3, node:sqlite) |
| Исполнитель | ИИ-агент (любой, читающий AGENTS.md) |
| Ветка | `feat/web-redesign` от `main` |
| Приоритет | 1) TG-постинг админом через сайт → 2) дизайн-качество → 3) консистентность остальных разделов |

**Суть задачи.** Сайт — витрина + рабочая панель владельца. Два столпа переделки:

1. **Красиво и качественно.** Единая дизайн-система 2.0: токены, компоненты, состояния, motion, доступность. Текущий каркас (тёмная mono-эстетика) сохраняется, поднимается уровень исполнения.
2. **Админ постит в Telegram через сайт.** Полноценный компоузер с превью, подтверждением, историей публикаций и человеческой обработкой ошибок Bot API — вместо сегодняшней «textarea + window.confirm».

Исполнитель **не invent'ит** новый стек, не меняет провайдеров/моделей, не трогает `challenge/` CLI и архив `1-day/…`/`10-day/`.

---

## 1. Цели и нецели

### Цели
- G1. Админ публикует пост в TG-канал через сайт:compose → превью → confirm → отправка → подтверждение с `message_id`. Путь ≤ 3 клика от `/dashboard`.
- G2. История публикаций (outbox) хранится, видна в UI, различает ручные и blog-публикации.
- G3. Дизайн-система 2.0: расширенные токены + библиотека `app/components/ui/`, покрывающая все страницы админки.
- G4. Все `window.confirm` / `window.alert` заменены на доступный Dialog-компонент (сейчас: `web/app/blog/posts/[id]/page.tsx:105`).
- G5. Лендинг `/` доводится до проданного состояния: полировка ритма, motion, мобильная версия 375px без деградаций.
- G6. Остальные разделы приведены к дизайн-системе без изменения логики (косметика + состояния).

### Нецели (не делать)
- N1. Светлая тема (остаёмся на тёмной; `next-themes`/`ThemeProvider` — решить: либо удалить мёртвый dep, либо оставить как есть, но не расширять).
- N2. Планировщик отложенных постов (нет сервера-крона; локальное приложение).
- N3. Альбомы/локальные файлы/загрузка медиа. Фото — только по URL (опционально, см. §13).
- N4. Мультиканальность (один канал из `TG_CHAT_ID`).
- N5. Аутентификация кроме существующей (HMAC-cookie из `web/lib/auth.ts` + middleware-гейт).
- N6. Изменения публичных API-контрактов, которые ломают `challenge/` CLI.
- N7. WebGL, тяжёлые анимационные библиотеки, новые UI-фреймворки. Motion — CSS + IntersectionObserver; максимум один лёгкий dep при явной необходимости (согласовать в PR-описании).

---

## 2. Текущее состояние (инвентарь, проверено 2026-09-07)

### 2.1 Инфраструктура
- **Auth.** `web/middleware.ts` (runtime nodejs): CSP с per-request nonce; PUBLIC_PATHS — точное множество (`/`, `/login`, `/harness`, `/jira`, `/blog/pipeline` + их API + auth-API). Неавторизованные: страницы → 302 `/login?next=<pathname>` (query выкидывается), `/api/*` → 401 JSON. Fail-closed. **Nonce-логику не трогать** — был инцидент «пустой body» при сломанном CSP (см. шапку middleware).
- **Auth-ядро.** `web/lib/auth.ts`: `SESSION_COOKIE`, `isValidSession()` (HMAC-cookie), `requireAuth(req)` для Route Handlers. Пароль — `WEB_ADMIN_PASSWORD` (задан, 16 симв.). Rate-limit на login есть (день 36).
- **Секреты.** `.env`: `TG_BOT_TOKEN` (46 симв.), `TG_CHAT_ID` (14 симв., формат `-100…` — приватный канал/супергруппа), `WEB_ADMIN_PASSWORD` — все заданы. Ключи читает только `web/lib/server/env.ts` (`getKeysStatus()` отдаёт configured-флаги и public-мету модели). Правило: **значения секретов никогда не покидают `lib/server/*`**.
- **БД.** `web/lib/server/db.ts`: singleton'ы `BlogDb(blog.sqlite)`, `RagStore`, `DialogDb`, `TgStore`, `TodoDb`; пути через `dataPath()` → `challenge/.data/`; запись — через `withDb()` (serial-очередь поверх синхронного `node:sqlite`).
- **TG-ядро.** `challenge/src/core/agents/telegram.ts`: `isTelegramConfigured()` (по env), `publishPost(text) → PublishResult {messageId?}` — Bot API `sendMessage`. Это **chokepoint**: веб вызывает его только через `web/lib/server/challenge.ts`.
- **Env-гейт публикации.** Все publish-роуты проверяют `isTelegramConfigured()`, иначе 400 «Telegram не настроен». Ошибки — через `safeMessage()` (redact `https?://` → `<url>`, токен не утекает).

### 2.2 Маршруты (23 роута, 7 групп — `web/data/nav.ts`)
| Группа | Маршруты | Статус |
| --- | --- | --- |
| core | `/` (публичный лендинг v2), `/dashboard`, `/showcase` | лендинг свежий (landing-v2), dashboard — тайлы статов |
| rag | `/rag`, `/rag/chat`, `/rag/chats`, `/rag/index`, `/rag/index-tg` | рабочий инструмент, UI утилитарный |
| chat | `/chat`, `/chat/[sessionId]`, `/joker` | рабочий |
| tg | `/tg/top`, `/tg/collect`, `/telegram/publish` | **publish — цель редизайна (§7)** |
| blog | `/blog/news`, `/blog/posts`, `/blog/posts/[id]`, `/blog/pipeline`, `/blog/scout` | **posts/[id] — интеграция с TG (§7.3)** |
| mcp | `/mcp/tools`, `/mcp/call`, `/mcp/todos` | рабочий |
| sys | `/agent`, `/briefing`, `/summary`, `/admin/servers`, `/settings` | рабочий |

Публичные (без login): `/`, `/login`, `/harness`, `/jira`, `/blog/pipeline`. Всё остальное — за гейтом.

### 2.3 Дизайн-токены сегодня (`web/tailwind.config.ts` + `app/globals.css`)
- Цвета RGB-переменными с alpha: `bg, surface, surface-2, line, line-strong, ink, dim, accent(+ink), ok, warn, err`; `darkMode: 'class'`.
- Шрифты: `--font-sans`, `--font-mono` (mono — доминирует в заголовках/данных).
- Радиус один: `6px`. Теней нет. Motion-токенов нет (только `l-reveal` — scroll-driven CSS `animation-timeline: view()`, фолбэк «контент виден», `app/globals.css:68-74`).
- Компоненты `app/components/ui/`: `Button`, `Card`, `icons.tsx` (8 иконок, вкл. `IconTelegram`). Этого мало — каждая страница добирает стили inline-классами.

### 2.4 Найденные дефекты и шероховатости (фиксировать в рамках ТЗ)
- D1. `window.confirm` для реальной отправки в TG и удаления поста (`blog/posts/[id]/page.tsx:105,~120`) — нет dialog-UX, нет показа target-канала.
- D2. `/telegram/publish` — голая форма: нет счётчика лимита 4096, нет превью, нет истории, нет различения ошибок Bot API.
- D3. Scroll-reveal лендинга прячет контент для fullPage-скриншотов/печати (анимация `entry 0-45%` + `both`): страница «пустая» ниже первого экрана в не-скролл контекстах. Требование §8.1.
- D4. Нет Toast/глобальных уведомлений — успех/ошибки только inline-блоками на странице.
- D5. Blog-пост не хранит факт публикации (`message_id`, дата) — после publish статус теряется при перезагрузке.
- D6. Гость, зайдя на `/dashboard`… не попадёт (гейт), но админ видит `/` в «каркасном» виде (заметка в `app/page.tsx:7`) — acceptable, оформить в ТЗ как норму: лендинг одинаков для ролей, отличия — кликабельность плиток.

---

## 3. Неизменяемые ограничения (нарушение = PR не принимается)

1. **Архив** `1-day/…`/`10-day/` — не трогать.
2. **Секреты** — только `lib/server/*` + `dotenv`. Ноль `NEXT_PUBLIC_*` с ключами. Клиентские компоненты импортируют только `web/lib/shared/*` и `web/data/*`.
3. **CSP/nonce** в `middleware.ts` — не ломать. Все страницы — dynamic rendering (свежий nonce). Новый inline-JS запрещён; стили через Tailwind.
4. **server-only chokepoint**: любой вызов `challenge/core` из веба — через `web/lib/server/challenge.ts`. Прямые импорты core в client-компонентах запрещены.
5. **Auth-гейт**: новые админские API — `/api/*` вне PUBLIC_PATHS (геймится автоматически) + `requireAuth()` вторым слоем для опасных операций (прецедент: `rag/index-tg` reset). Публичные пути — только добавлением в PUBLIC_PATHS осознанно.
6. **Реальные внешние действия** (отправка в TG, удаление) — всегда через явный confirm-Dialog с указанием target. Без auto-retry отправки (только ручной повтор).
7. **ESM-импорты** внутри `src` — с расширением `.js` для TS-файлов (конвенция репо).
8. **`node:sqlite`** — только через singleton + `withDb()` для записи. Никаких новых соединений на запрос.
9. **`pnpm --filter web typecheck`** зелёный перед каждым коммитом (запуск из корня). Коммит-префиксы актуальной эры: `feat(web): …`, `fix(web): …` (дни завершены на day-36).
10. **Windows-дев**: dev-сервер `pnpm --filter web dev` (127.0.0.1:3000). Скрипты не должны требовать POSIX-only.
11. **Тексты и UI** — на русском, стиль существующего интерфейса (строчные метки mono, «вы»-нейтральный тон).
12. **`safeMessage()`** — для всех сообщений об ошибках внешних вызовов, попадающих в UI/логи.

---

## 4. Роли и сценарии (user journeys)

### Гость (не авторизован)
- Видит `/`, `/harness`, `/jira`, `/blog/pipeline`, `/login`. Остальное → 302 на `/login?next=…`.
- Макро-конверсия лендинга — подписка на TG-канал (кнопки `SubscribeButton` → `t.me/…`).
- На лендинге плитки-артефакты без href, secondary-CTA → якорь `#proof` (текущее поведение сохранить).

### Админ (авторизован)
- **J1 «Быстрый пост»**: login → `/dashboard` → кнопка «Новый пост в TG» → компоузер → превью → confirm (показан канал) → отправка → toast «Опубликовано, message_id=…» → запись в истории.
- **J2 «Пост из блога»**: `/blog/posts` → открыть черновик → правка → «Опубликовать в Telegram» → confirm → статус поста становится `published` (+`message_id`).
- **J3 «Проверить, что ушло»**: `/telegram/publish` (или `/dashboard`) → блок «История публикаций»: текст-превью, время, источник (manual/blog/summary), `message_id`, ошибка если была.
- **J4 «Ошибка TG»**: токен отозван/сеть недоступна → понятная ошибка в dialog/toast, текст сообщения **не теряется** (остаётся в редакторе + автосохранённый черновик в localStorage), кнопка «Повторить».

---

## 5. Дизайн-система 2.0

### 5.1 Принципы
- Тёмная mono-эстетика сохраняется: контраст достигается **типографикой и плотностью**, а не декором. Единственный допустимый glow — финальная CTA-панель лендинга (текущая норма `app/page.tsx:2`).
- Всё состояние интерфейса явно нарисовано: hover/focus-visible/active/disabled/loading/empty/error — для каждого интерактивного компонента.
- Progressive enhancement: контент виден без JS и при печати; анимации — только улучшение (`prefers-reduced-motion` обязателен).

### 5.2 Токены (расширить `tailwind.config.ts` + `globals.css`)
| Группа | Токены | Значения |
| --- | --- | --- |
| Цвета | без изменений | текущий набор; добавить `accent-dim` (40% accent для бордеров фокуса) |
| Радиусы | `rounded-sm/md/lg/full` | `4 / 6 / 10 / 9999` (сейчас только 6px) |
| Тени | `shadow-panel`, `shadow-pop` | panel: `0 1px 0 rgb(0 0 0 / .4)`; pop (для Dialog/Toast): `0 8px 32px rgb(0 0 0 / .5)` |
| Motion | `duration-fast/base/slow` | `120 / 200 / 320ms`; easing `cubic-bezier(.2,.8,.2,1)` |
| Z-index | `z-nav(20), z-dialog(50), z-toast(60)` | зафиксировать шкалу |
| Отступы | шкала 4px Tailwind | ритм секций: `gap-4` внутри карточек, `space-y-6` между секциями, `py-10` секции админки |

### 5.3 Типографика
- Шкала (clamp, без layout-shift, шрифты через `next/font`): display `clamp(28px,4vw,44px)` / h1 `24` / h2 `20` / h3 `16` / body `14-16` / meta `12-13` mono.
- Заголовки секций админки: единый паттерн «`// NN · label`» (как на лендинге) — вынести в компонент `SectionHead`.
- Числовые данные — `tabular-nums` (уже используется — сделать правилом).

### 5.4 Компоненты `app/components/ui/` (минимальный состав)
| Компонент | Контракт | Критерий качества |
| --- | --- | --- |
| `Button` | variants: `primary/ghost/danger`; sizes: `sm/md`; `loading` (spinner + блокировка), `icon`-режим | focus-ring единый, min-height 36 (44 на тач-брейкпойнтах) |
| `Card` | label + actions slot | текущий вариант + опциональный `tone: default/warn/danger` |
| `Dialog` | `role="dialog"`, `aria-modal`, focus-trap, Esc, клик по подложке = cancel | заменяет все `window.confirm`; danger-вариант с красной шапкой |
| `Toast` | очередь, `variant: ok/err/info`, auto-hide 4s, ручной dismiss | глобальные successe/error; портал в body, z-toast |
| `Field` | label + hint + error слот для Input/Textarea/Select | все формы через Field; label связан `for/id` |
| `Textarea` | autosize (cap 12 рядов), счётчик `n/4096`, warn ≥3800 | используется в компоузере и постах |
| `ConfirmDialog` | надстройка: title, body, `confirmLabel`, `tone`, async `onConfirm` с loading | паттерн для publish/delete |
| `Badge` | `draft/published/error` статусы | таблички блогов, outbox |
| `EmptyState` | иконка + текст + action | все списки |
| `Skeleton` | прямоугольный/строчный | loading-состояния списков |
| `Tabs` | строковые табы | превью компоузера (raw/рендер) |
| `Tooltip` | css-only, `delay 300ms` | иконочные кнопки |

Требование миграции: после Ф1 в `ui/` не остаётся страниц с сырыми `<button>`/`<input>` вне компонентов (допуск: узкие кейсы с комментарием-обоснованием).

### 5.5 Иконки
- Единый `icons.tsx`, stroke 1.5–1.75, viewBox 24. Дозаявить: `send`, `history`, `edit`, `trash`, `external`, `copy`, `check`, `x`, `warning`, `eye/eye-off`, `chevron-*`. Запрет разнобоя: никакие иконки мимо этого файла.

### 5.6 Motion
- Появление страниц админки: без enter-анимаций (мгновенно) — это инструмент, не витрина.
- Лендинг: текущий `l-reveal` чинится по §8.1; hover карточек — `translateY(-2px)` + border-accent, 200ms.
- Dialog/Toast: 120ms fade + 4px slide; при `prefers-reduced-motion: reduce` — без transform.

### 5.7 Сетка и адаптив
- Контейнер админки: `max-w-6xl mx-auto px-5`. Лендинг — текущие контейнеры страницы.
- Брейкпойнты проверять на **375 / 768 / 1440**. Таблицы при <768 превращаются в карточные списки (блог, outbox).
- Nav: текущая схема (гость — бренд+Войти; админ — MobileNav+core+модель+logout) сохраняется; активный пункт подсвечивается (`aria-current="page"`).

### 5.8 Доступность (блокирующие критерии)
- Контраст текста ≥ 4.5:1 к `--bg` (проверить `dim` на `surface-2`).
- Весь интерактив с клавиатуры; видимый focus (`focus-visible` ring, единый стиль).
- Dialog: фокус в первый контрол, Esc/cancel возвращает фокус кнопке-инициатору.
- Формы: ошибки текстом (`aria-describedby`), не только цветом.

---

## 6. Информационная архитектура админки (целевая)

- `/dashboard` — хаб: (а) быстрые действия: «Новый пост в TG», «Черновики блога», «История публикаций»; (б) статус-строка ключей (уже есть `getKeysStatus`) + флаг TG configured; (в) тайлы статистики (как сейчас) — визуально причёсать к системе.
- Группа «Контент»: `/blog/*`, `/telegram/publish`, `/summary`.
- Остальные группы — как в `data/nav.ts` (переименования не обязательны; допустима смена label на человеческие, href не менять).

---

## 7. Функциональная спецификация: TG-постинг (ядро ТЗ)

### 7.1 Компоузер `/telegram/publish` (редизайн страницы)
Состояния страницы: `form` → `confirming` (Dialog) → `sending` → `done | error`.

Поля и поведение:
1. **Textarea** (mono, autosize): текст сообщения. Поддержка разметки Telegram-HTML: `<b> <i> <u> <s> <a href> <code> <pre> <blockquote> <tg-spoiler>`. Панель-помощник над полем: кнопки-обёртки B / I / U / `code` / ссылка (оборачивают выделение; если выделения нет — вставляют парные теги в позицию курсора).
2. **Счётчик**: `n / 4096` (Bot API limit). ≥3800 — warn-цвет; >4096 — блокировка кнопки + ошибка в Field.
3. **Табы превью**: `Рендер | HTML`. Рендер — имитация сообщения Telegram (тёмная тема, пузырь, mono для `code`, blockquote с полосой) **на клиенте**, рендерер — whitelist-парсер из `lib/shared/tg-html.ts` (общий для превью и для серверного sanitize). HTML-таб — исходник как есть.
4. **Статус TG**: если `isTelegramConfigured() === false` — баннер «Telegram не настроен: превью доступно, отправка выключена» (publish-кнопка disabled). Остальной UI полностью работает (dry-run).
5. **Кнопка «Опубликовать»** (primary, `IconSend`): disabled если пусто/перелимит/отправка. Открывает **ConfirmDialog**: «Отправить в канал …?» + свернутый превью первых ~6 строк + пометка «Реальная отправка». Confirm → POST.
6. **Успех**: toast ok «Опубликовано (message_id=…)»; форма очищается; запись появляется в истории (§7.2); кнопка «Новое сообщение» — фокус в пустой textarea.
7. **Ошибка**: текст сообщения сохраняется в редакторе; toast err + развёрнутая причина в Card под формой; кнопка «Повторить» открывает confirm заново. Автосохранение черновика в `localStorage` (debounce 500ms, ключ `tg-compose-draft`), восстановление при открытии страницы, очистка после успешной отправки.
8. **История публикаций** — секция внизу страницы (§7.2): последние 20, колонки: время · источник (badge) · превью текста (1 строка, ellipsis) · message_id · статус (ok/error). Клик — раскрытие полного текста (expand inline).

### 7.2 История публикаций (outbox) — модель данных
**Решение**: веб-собственная таблица, без изменений `challenge/core`. Новый модуль `web/lib/server/outbox.ts`: singleton `OutboxDb` над `dataPath('web-outbox.sqlite')`, запись через `withDb()`.

```sql
CREATE TABLE IF NOT EXISTS tg_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual','blog','summary')),
  blog_post_id INTEGER,            -- ссылка при source='blog'
  message_id INTEGER,              -- из Bot API при успехе
  status TEXT NOT NULL CHECK (status IN ('ok','error')),
  error TEXT,                      -- safeMessage-текст при error
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Пишется в **каждом** publish-пути (manual/blog/summary) — единый helper `web/lib/server/tg-publish.ts`: `publishToTelegram(text, source, blogPostId?)` = гейт `isTelegramConfigured()` → `publishPost()` (chokepoint) → запись в outbox (ok/error) → возврат результата. Существующие роуты переходят на helper (cutover, дублей гейта не остаётся).

API:
- `GET /api/telegram/history?limit=20` → `{ ok, items: OutboxRow[] }` (requireAuth — гейт middleware и так 401, явный `requireAuth` по прецеденту опасных только для мутаций; history — чтение, достаточно гейта).
- `POST /api/telegram/publish` (существующий) — расширить схему `tgPublishSchema` (`lib/shared/forms.ts`): `text: string().min(1).max(4096)`, `parse_mode?: 'HTML'` (дефолт `HTML`; пустая строка/`undefined` = без разметки — передавать в `publishPost` второй опциональный параметр; core-сигнатуру расширять back-compat-ably).

### 7.3 Интеграция blog → TG
`/blog/posts/[id]`:
- Кнопка «Опубликовать в Telegram» → ConfirmDialog (target-канал, реальная отправка) → `POST /api/blog/posts/[id]/publish` → внутри `publishToTelegram(text, 'blog', id)`.
- После успеха пост помечается опубликованным. **Хранение статуса поста** — в самом `blog.sqlite` минимально-инвазивно: допустимо добавить колонку `tg_message_id INTEGER NULL` через `ALTER TABLE`-миграцию в `BlogDb` (challenge/core) **или** join с outbox по `blog_post_id` (без изменений core). **Выбор исполнителя: join с outbox** (меньше риск). На странице — Badge `draft | published (msg 1234, 07.09 14:02)` + кнопка «Опубликовать заново» (отдельный confirm, пишет новую запись outbox).
- Удаление поста — ConfirmDialog danger (текст: безвозвратно).

### 7.4 Обработка ошибок Bot API → UX (карта)
| Условие | UX |
| --- | --- |
| `isTelegramConfigured() === false` | 400 «Telegram не настроен (TG_BOT_TOKEN/TG_CHAT_ID не заданы)» — как сейчас; UI: dry-run баннер |
| HTTP 401 / `Unauthorized` | «Токен бота отклонён Telegram. Проверьте TG_BOT_TOKEN» |
| HTTP 400 `chat not found` | «Канал не найден. Проверьте TG_CHAT_ID и что бот — администратор канала» |
| HTTP 403 `bot is not a member` / `not enough rights` | «Боту нужны права администратора канала» |
| HTTP 429 (+`retry_after`) | «Telegram просит подождать N с» + кнопка «Повторить через Nс» (disabled до истечения) |
| Сеть/таймаут (AbortSignal 15s) | «Telegram недоступен (таймаут). Текст сохранён — повторите» |

Реализация: `web/lib/server/tg-publish.ts` маппит `publishPost`-ошибки (расширить `challenge/src/core/agents/telegram.ts` возвратом `errorKind`/`retryAfter` — **обратно-совместимо**, либо парсить текст ошибки в вебе; допустим вариант в вебе, если core трогать нельзя). Все тексты проходят `safeMessage()`.

### 7.5 Опционально (фаза 2, если база принята)
- Фото по URL: `sendPhoto` с caption (лимит 1024) — поле «Изображение (URL)» с превью 64px; каптион-счётчик переключается 4096→1024.
- Из истории: «Править в TG» (`editMessageText`) и «Удалить в TG» (`deleteMessage`) — каждый через confirm; записи outbox обновляются.

---

## 8. Спецификации страниц

### 8.1 `/` — лендинг (полировка, не ре design с нуля)
- Структура сохраняется: hero-оффер → `01 proof` → `02 артефакты` → `03 канал` (`app/page.tsx`, данные `data/landing.ts`).
- **Fix D3**: reveal-анимация не должна прятать контент в не-скролл контекстах. Требование: при `@media print`, при отсутствии JS-гидратации и для fullPage-скриншота весь контент видим. Допустимые решения: (а) `animation-range: entry 0% entry 100%` + начальный opacity ≥ 0.25; или (б) reveal только на `transform`, без opacity<1; или (в) обернуть в `@supports` + класс `.js-ready`, навешиваемый мини-скриптом. Проверка: fullPage-скриншот показывает все 4 секции.
- Отступы между секциями выровнять (сейчас разнобой пустых пространств); мобильная 375px: hero-заголовок не переносится посимвольно, плитки артефактов — одна колонка, CTA-кнопки full-width.
- `SubscribeButton` — все CTA только через него (текущее правило сохранить).

### 8.2 `/login`
- Карточка по центру (max-w-sm): бренд, поле пароля с eye-toggle (иконки), error-строка (текст из API), submit с loading. Успех — текущее поведение (`window.location.assign(next)` — не менять, причина в шапке `LoginForm.tsx`).
- rate-limit ошибку показывать человекочитаемо.

### 8.3 `/dashboard`
- Секция «Быстрые действия»: 3 крупные кнопки-карточки (J1/J2/J3 пути).
- Статус-строка: cloud-ключи (provider/model из `getKeysStatus`), `tg: configured/not configured` (из `getKeysStatus` — расширить env.ts флагом, значение токена наружу не идёт).
- Тайлы статистики — текущие данные, обёрнутые в новую Card/Badge-систему; numbers `tabular-nums`.

### 8.4 `/blog/posts`
- Список: таблица на desktop (заголовок-превью · дата · источник · статус TG (из outbox join) · действия), карточки на mobile.
- Пустое состояние (нет постов): EmptyState с кнопкой «Открыть pipeline» и объяснением откуда берутся посты.
- Действия строки: открыть · удалить (confirm). Никаких inline-publish из списка (только из карточки поста — осознанно, чтобы не плодить опасные кнопки).

### 8.5 `/blog/posts/[id]`
- Toolbar: «Сохранить» (primary), «Опубликовать в Telegram» (primary + IconSend, disabled если пусто), «Удалить» (danger, справа).
- Статус-строка публикации: Badge + `message_id` + время (join outbox, §7.3).
- Редактирование textarea — тот же `Textarea`-компонент со счётчиком 4096.

### 8.6 `/blog/pipeline`, `/blog/scout`, `/jira`, `/harness`, `/rag/*`, `/chat`, `/summary`, `/briefing`, `/tg/*`, `/mcp/*`, `/admin/servers`, `/settings`, `/showcase`
- Логика не меняется. Фаза косметики: формы на `Field`, кнопки на `Button`, confirm'ы на `Dialog`, error/success на `Toast`, списки с EmptyState/Skeleton, заголовки через `SectionHead`. Красные LANDMINE-предупреждения (`rag/index-tg`) сохранить как есть (tone danger).
- `/summary`: POST-publish переходит на `publishToTelegram(text,'summary')` (cutover §7.2).

### 8.7 Навигация
- `Nav.tsx`/`MobileNav.tsx`: активный пункт `aria-current="page"` + визуальное выделение; группы в MobileNav с заголовками из `data/nav.ts`. В guest-ветке — ничего не меняется (анти-утечка — правило из шапки Nav сохранить).
- В admin-Nav ссылка «publish» переименовывается в «TG-постинг» (группа tg).

### 8.8 Системные страницы
- `not-found.tsx`, `error.tsx`, `global-error.tsx` — стилизовать в систему (mono-заголовок, ссылка «На главную», для error — кнопка retry). Сегодняшние заглушки заменить.

---

## 9. Нефункциональные требования

- **Перф**: LCP < 2.5s, CLS < 0.1, INP < 200ms на 1440×900 localhost (проба `perf-probe.tsx` уже в dev-режиме — использовать для замеров). Шрифты через `next/font` c `display: swap` (layout-shift от шрифтов = 0). Никаких новых heavy-dep.
- **SEO/мета**: на каждой странице `metadata` (title/description); OG-теги на лендинге (og:title, og:description, og:type=website); favicon присутствует.
- **Безопасность**: CSP как есть; cookies httpOnly+sameSite (текущие `lib/auth.ts`); rate-limit: login (есть) + на `POST /api/telegram/publish` и publish-blog — простой in-memory лимитер (напр. 10/мин на сессию, 429 с `retry_after`); логи без секретов (правило safeMessage).
- **Надёжность**: все fetch к Bot API с AbortSignal.timeout(15_000); БД — только через withDb; миграции outbox — идемпотентный `CREATE TABLE IF NOT EXISTS` при первом обращении.
- **Код**: комментарии — только для неочевидного (конвенция репо); шапки-комментарии у новых файлов в стиле существующих (что/почему/гейты).

---

## 10. Верификация и приёмка (Definition of Done)

### 10.1 Обязательные прогоны
1. `pnpm --filter challenge typecheck` и `pnpm --filter web typecheck` из корня — 0 ошибок.
2. `pnpm --filter web build` — успешная production-сборка (ловит CSP/nonce и сервер/клиент-утечки импортов).
3. Скриншот-матрица (headless-браузер, приложить к PR): страницы `{/, /login, /dashboard, /telegram/publish, /blog/posts, /blog/posts/<id>, /blog/pipeline}` × ширины `{1440, 768, 375}`; отдельно fullPage лендинга (критерий §8.1 — все секции видимы).

### 10.2 E2E-сценарии (прогнать руками/скриптом, описать результат в PR)
- **S1 TG-постинг (реальный)**: login → компоузер → текст с `<b>`-разметкой → превью корректен → confirm → toast ok → запись в истории с message_id → сообщение реально появилось в канале. Затем «Сухой» прогон того же с пустыми `TG_BOT_TOKEN`/`TG_CHAT_ID` в `.env.local` (не коммитить, удалить после): dry-run баннер, publish disabled, превью работает.
- **S2 Blog→TG**: создать пост через UI блога (или pipeline) → publish → badge published с message_id → запись outbox source=blog.
- **S3 Ошибки**: временно невалидный `TG_BOT_TOKEN` → понятная ошибка §7.4, текст сообщения не потерян, «Повторить» работает. Вернуть токен.
- **S4 Auth-гейт**: гость на `/telegram/publish` → 302 `/login?next=…`; `curl` на `POST /api/telegram/publish` без cookie → 401 JSON; с cookie, но без TG-env → 400 dry-run-текст.
- **S5 A11y**: навигация с клавиатуры: login → компоузер → открыть Dialog → Esc возвращает фокус; ни одного интерактива без focus-ring.

### 10.3 Критерии качества дизайна (субъективное, но проверяемое)
- Ни одной страницы админки с «голой» HTML-кнопкой или непарной формой без Field-обёртки.
- Все три ширины скрин-матрицы без горизонтального скролла и наложений.
- Единый визуальный язык: проверка «переклейкой» — любые два раздела в одной таблице стилей не различаются жанром (только плотностью данных).

---

## 11. План работ (фазы, каждая = отдельные коммиты, в конце фазы — typecheck+build)

| Фаза | Содержание | Готово когда |
| --- | --- | --- |
| Ф0 | Ветка `feat/web-redesign`; baseline-скриншоты текущего сайта (матрица §10.1) | baseline приложен к PR-описанию |
| Ф1 | Токены §5.2 + компоненты ui/ §5.4 (+Dialog, Toast, Field, Textarea, Badge, EmptyState, Skeleton, Tabs, Tooltip, ConfirmDialog) | все компоненты существуют, миграция confirm'ов сделана, typecheck |
| Ф2 | TG-ядро: `tg-publish.ts` helper, outbox, история, редизайн компоузера §7.1, cutover blog/summary роутов, карта ошибок §7.4 | S1–S4 зелёные |
| Ф3 | Лендинг §8.1 (reveal-fix, отступы, 375px) | fullPage-критерий, мобилка без дефектов |
| Ф4 | Админ-каркас: dashboard §8.3, blog list/detail §8.4–8.5, login §8.2, nav §8.7, системные страницы §8.8 | скрин-матрица Ф4 чистая |
| Ф5 | Консистентность остальных разделов §8.6 + a11y-проход §10.2-S5 + перф-замеры | §10.1–10.3 выполнены целиком |
| (Ф2+) | Опционально §7.5 (фото, edit/delete в TG) — отдельным коммитом, только после приёмки Ф2 | — |

Порядок Ф2 раньше Ф3 — принципиально: сначала ценность (постинг), потом красота витрины.

## 12. Правила исполнения для агента
- Работать по AGENTS.md репо; этот документ старше частных привычек.
- Один логический изменения-коммит: `feat(web): …` / `fix(web): …`; перед каждым — typecheck (ограничение §3.9).
- Никаких заглушек «TODO: implement» в принимаемых фазах. Фаза либо сделана целиком, либо не открывается.
- В PR-описании: скриншоты до/после, результат S1–S5, список изменённых файлов, отклонения от ТЗ (если были — с обоснованием).
- Если обнаружен конфликт ТЗ с реальностью кода (например, схема BlogDb не позволяет join) — остановиться, зафиксировать конфликт в PR-описании, выбрать наименее инвазивное решение, не молча менять контракт.

## 13. Открытые вопросы (дефолты — чтобы не блокироваться)
| Вопрос | Дефолт |
| --- | --- |
| Фото по URL (§7.5) | не делать в базовом скоупе |
| Edit/delete опубликованного в TG (§7.5) | не делать в базовом скоупе |
| Outbox: join vs колонка в BlogDb (§7.3) | join по `blog_post_id` |
| Маппинг ошибок Bot API в core или в вебе (§7.4) | в вебе (`tg-publish.ts`), core не трогать |
| `next-themes` (N1) | оставить как есть, не расширять |

## 14. Карта файлов (ожидаемый периметр изменений)
- Новые: `web/lib/server/outbox.ts`, `web/lib/server/tg-publish.ts`, `web/lib/shared/tg-html.ts`, компоненты ui/ §5.4, `web/app/telegram/publish/*` (редизайн), `web/app/api/telegram/history/route.ts`.
- Изменяемые: `web/tailwind.config.ts`, `web/app/globals.css`, `web/lib/shared/forms.ts` (tgPublishSchema), `web/app/api/telegram/publish/route.ts`, `web/app/api/blog/posts/[id]/publish/route.ts`, `web/app/api/summary/route.ts`, `web/app/blog/posts/*`, `web/app/dashboard/page.tsx`, `web/app/login/*`, `web/app/page.tsx`, `web/app/globals.css`, `web/app/components/{Nav,MobileNav}.tsx`, `web/data/nav.ts`, `web/app/{not-found,error,global-error}.tsx`, все страницы §8.6 (косметика).
- Не трогать: `web/middleware.ts` (кроме случая, когда ТЗ явно требует), `web/lib/auth.ts`, `web/lib/server/env.ts` (только добавить флаг configured для TG), `challenge/src/core/**` (дефолт §13), архив `1-day/…`/`10-day/`.
