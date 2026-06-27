# День 18 — TODO-планировщик, MCP→MCP, ежедневные сводки в Telegram

MCP HTTP-сервер, который работает 24/7: хранит задачи в SQLite, раз в день
отправляет сводку ожидающих дел в Telegram-канал и проксирует вызовы к
удалённому MCP-серверу (MCP→MCP).

> Задание дня: создать MCP-инструмент с отложенным фоновым/периодическим
> выполнением, который работает 24/7. TODO-планировщик с напоминаниями в
> Telegram: задачи с настраиваемым интервалом повторения (ежечасно,
> ежедневно, еженедельно).

---

## Что внутри (одним абзацем)

`runServer()` (в `demos/day-18-server.ts`) поднимает HTTP-сервер на
`node:http`, регистрирует 8 MCP-инструментов, подключается к удалённому
Everything Server и запускает фоновый таймер ежедневной сводки. Любой клиент
(CLI, REPL, `curl`, другой агент) говорит с сервером по JSON-RPC 2.0 поверх
HTTP POST на единственный эндпоинт `/mcp`.

---

## Архитектура

```
Клиент (CLI / REPL / curl / агент)
        │  HTTP POST JSON-RPC 2.0
        ▼
┌─────────────────────────────────────────────────────┐
│  McpHttpServer  (node:http, :3001/mcp)              │
│  ├── initialize / tools/list / tools/call           │
│  └── 8 инструментов (см. ниже)                      │
│                                                     │
│  TodoDb ── SQLite (.data/todos.sqlite)              │
│    ├── todos        — задачи + recurring-расписание │
│    └── todo_meta    — key/value (дата daily-summary) │
│                                                     │
│  McpHttpClient ──► Everything Server (MCP→MCP)      │
│                                                     │
│  daily-summary таймер (5 мин → раз в день)          │
└─────────────────────────────────────────────────────┘
        │  publishPost()
        ▼
   Telegram Bot API ── (HTTPS_PROXY → gost → socks5) ──► канал
```

На проде VPS спереди стоит Caddy (`https://api.memo7.ru/mcp` → `:3001`),
Telegram ходит через HTTP-прокси gost → socks5 (API заблокирован).

---

## Компоненты

### `McpHttpServer` (`core/mcpHttpServer.ts`)
Транспорт: один POST-эндпоинт, JSON-RPC 2.0. Без внешних зависимостей —
только `node:http`. Поддерживает `initialize`, `notifications/initialized`,
`tools/list`, `tools/call`. GET отдаёт HTML-статус-страницу, OPTIONS — CORS.
Каждая тулза — это `{ name, description, inputSchema, handler }`; ошибки
исполнения handler-а возвращаются как tool-result (`isError: true`), а не как
транспортная ошибка.

### `TodoDb` (`core/todoDb.ts`)
SQLite через `node:sqlite` (Node 22+). Две таблицы:

- **`todos`** — `text`, `scheduled_at` (ISO разового срабатывания),
  `recurring` (`daily` | `weekly` | `hourly`), `day_of_week` (0=Вс … 6=Сб),
  `interval_hours` (шаг для hourly), `status` (`pending` | `done` | `dismissed`),
  `last_sent`, `created_at`.
- **`todo_meta`** — key/value, здесь живёт `last_daily_summary_date` — дата
  последней отправленной сводки (guard от дублей в тот же день).

`getDueTodos()` выбирает pending-задачи, у которых наступило время срабатывания
по recurring-расписанию (сравнение `last_sent` с `date('now')` / вычисленным
следующим интервалом). Используется для ручной/внешней обработки расписания.

### `McpHttpClient` (`core/mcpHttpClient.ts`)
JSON-RPC клиент: `connect()` (initialize), `listTools()`, `callTool(name, args)`.
В день-18-сервере используется дважды: сервер сам становится клиентом к
удалённому **Everything Server** (`everything.mcp.inevitable.fyi`), чтобы
проксировать его инструменты наружу через свои `call_remote_tool` /
`list_remote_tools` — это и есть **MCP→MCP**.

### Telegram (`core/agents/telegram.ts`)
`publishPost(text)` шлёт сообщение в канал через Bot API. Токен и chat_id — из
`TG_BOT_TOKEN` / `TG_CHAT_ID`. Если задан `HTTPS_PROXY`, fetch идёт через
`undici.ProxyAgent` (нужен для сетей, где `api.telegram.org` заблокирован).
`isTelegramConfigured()` — быстрая проверка наличия обоих env.

---

## 8 инструментов

| Инструмент          | Что делает                                                        |
|---------------------|-------------------------------------------------------------------|
| `add_todo`          | Добавить задачу. Параметры: `text`, `scheduled_at`, `recurring` (`daily`/`weekly`/`hourly`), `day_of_week`, `interval_hours`. |
| `list_todos`        | Список задач, опц. фильтр `status` (`pending`/`done`/`dismissed`).|
| `complete_todo`     | Пометить задачу `done` (по `id`).                                 |
| `dismiss_todo`      | Пометить задачу `dismissed` (по `id`).                            |
| `delete_todo`       | Удалить задачу навсегда (по `id`).                                |
| `send_summary`      | Вручную отправить сводку всех pending в Telegram + `markSent`.    |
| `call_remote_tool`  | MCP→MCP: вызвать тулзу удалённого Everything Server.              |
| `list_remote_tools` | MCP→MCP: список тулз удалённого сервера.                          |

---

## Ежедневная сводка (новое)

Старый фоновый цикл («spam-loop») проверял due-задачи каждые 60 секунд и
отправлял их по одному — это мешало жить и засоряло канал. Заменён на
**регулярный ежедневный summary** в `runDailySummary()`:

1. Таймер тикает каждые **5 минут** (`SUMMARY_CHECK_MS`).
2. Если Telegram не настроен — выходим (нечего отправлять).
3. Если локальный час сервера `< SUMMARY_HOUR` (по умолчанию **9**) — выходим,
   ещё не утро.
4. Читаем `todo_meta.last_daily_summary_date`. Если она уже равна сегодняшней
   локальной дате — выходим, сегодня уже отправляли.
5. Берём все pending-задачи. Если их **0** — выходим, дату НЕ фиксируем (утренняя
   сводка приедет, как только задача появится).
6. Шлём `getPendingSummary()` одним сообщением в Telegram.
7. При успехе записываем сегодняшнюю дату в `todo_meta` → до завтра дубля не будет.

Ключевые свойства:
- **Раз в день**, а не раз в минуту — канал не засоряется.
- **Guard по дате** через `todo_meta` — переживает рестарт сервиса (дата в SQLite).
- **Не трогает `last_sent` отдельных задач** — recurring-логика `getDueTodos()`
  остаётся нетронутой (сводка — это напоминание обо всём списке, а не отметка
  «задача выполнена»).
- Локальная дата/час берутся через `new Date()` — таймзона сервера (на VPS
  настраивается системно или через `TZ`).

---

## Запуск

### 1. Поднять сервер (scheduler)
```bash
pnpm --filter challenge start -- scheduler
# свой порт:
pnpm --filter challenge start -- scheduler --port 3002
```
Сервер слушает `http://localhost:3001/mcp`, подключается к Everything Server и
запускает daily-summary таймер. Работает, пока не убьют (SIGINT/SIGTERM
аккуратно закрывают таймер, сервер, БД и remote-клиент).

### 2. Клиентские команды (по умолчанию стучатся на `https://api.memo7.ru/mcp`)
```bash
# добавить разовую / повторяющуюся задачу
pnpm --filter challenge start -- todo "Сделать зарядку" --daily
pnpm --filter challenge start -- todo "Отчёт" --weekly 1     # каждый понедельник
pnpm --filter challenge start -- todo "Проверить почту" --hourly 2

# список / статусы
pnpm --filter challenge start -- todos --pending
pnpm --filter challenge start -- todos --done

# жизненный цикл
pnpm --filter challenge start -- done 3
pnpm --filter challenge start -- dismiss 3
pnpm --filter challenge start -- rm-todo 3

# отправить сводку вручную (сразу, не дожидаясь SUMMARY_HOUR)
pnpm --filter challenge start -- summary

# произвольный MCP-вызов и список инструментов
pnpm --filter challenge start -- mcp list_todos
pnpm --filter challenge start -- mcp-tools
```
Локальный сервер вместо прода: добавь `--server http://localhost:3001/mcp`.

### 3. REPL (внутри чата)
Те же команды слэшами: `/todo`, `/remind`, `/todos`, `/done`, `/dismiss`,
`/rm-todo`, `/summary`, `/mcp`, `/mcp-tools`.

### 4. Напрямую curl (JSON-RPC)
```bash
curl http://localhost:3001/mcp -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"add_todo","arguments":{"text":"Привет день 18","recurring":"daily"}}}'
```

---

## Демо дня

`pnpm --filter challenge start -- day-18` — клиентский сценарий: подключается к
запущенному серверу, показывает инструменты, дёргает `list_remote_tools`,
`add_todo`, `list_todos`, `send_summary`, `call_remote_tool` (echo). Без
запущенного `scheduler` завершится с подсказкой.

---

## Переменные окружения

| Переменная       | Назначение                                              |
|------------------|---------------------------------------------------------|
| `TG_BOT_TOKEN`   | Токен Telegram-бота (обязательно для отправки).         |
| `TG_CHAT_ID`     | Канал/чат назначения.                                   |
| `HTTPS_PROXY`    | HTTP-прокси для Telegram (gost → socks5).               |
| `SUMMARY_HOUR`   | Час ежедневной сводки, 0–23 (по умолчанию 9).           |
| `MCP_SERVER_URL` | URL сервера для демо `day-18` (по умолчанию `localhost:3001/mcp`). |

---

## Деплой (продуктив)

- **systemd `mcp-server`** — держит `start -- scheduler` живым 24/7.
- **systemd `gost-proxy`** — `gost -L http://127.0.0.1:3128 -F socks5://…`,
  мост HTTP↔socks5 для обхода блокировки Telegram API.
- **Caddy** — терминирует TLS и проксирует `https://api.memo7.ru/mcp` → `:3001`.
- База живёт в `challenge/.data/todos.sqlite` (WAL-режим).

---

## Файлы дня 18

| Файл                              | Роль                                                |
|-----------------------------------|-----------------------------------------------------|
| `src/demos/day-18-server.ts`      | MCP HTTP-сервер: 8 тулз + daily-summary таймер.     |
| `src/demos/day-18.ts`             | Клиентское демо-сценарий.                           |
| `src/core/todoDb.ts`              | SQLite: `todos` + `todo_meta`, recurring-логика.    |
| `src/core/mcpHttpServer.ts`       | JSON-RPC транспорт над `node:http`.                 |
| `src/core/mcpHttpClient.ts`       | JSON-RPC клиент (в т.ч. MCP→MCP к Everything).      |
| `src/core/agents/telegram.ts`     | `publishPost()` + `isTelegramConfigured()`.         |
| `src/core/todoParser.ts`          | Парсер флагов `--daily/--weekly/--hourly`.          |

Команда-точка-входа: `pnpm --filter challenge start -- scheduler`.
