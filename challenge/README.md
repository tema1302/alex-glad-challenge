# challenge/ — монолит LLM-челленджа

Единая кодовая база для прохождения челленджа по LLM «изнутри». Все 10 дней
прошивания реализованы как демо-модули и запускаются через один CLI. Каждый
новый день — это доработка этого монолита в отдельной git-ветке (см.
[`AGENTS.md`](../AGENTS.md)).

Помимо демо дней, здесь живёт **pipeline блог-агентов** для канала «Иди на
факты глянь»: RSS → агент 1 (топ новостей) → агент 2 (пост в стиле канала) →
агент 3 (фактчекинг).

## Структура

```
challenge/
├── package.json              # единый пакет
├── tsconfig.json             # локальный tsconfig
├── .data/                    # SQLite база и артефакты (в .gitignore)
│   └── blog.sqlite
└── src/
    ├── cli.ts                # точка входа CLI
    ├── repl.ts               # интерактивный чат-REPL
    ├── core/                 # общая библиотека
    │   ├── index.ts          # публичный API
    │   ├── client.ts         # LlmClient (OpenAI-совместимый HTTP)
    │   ├── types.ts          # ChatMessage, Usage, ChatParams, ...
    │   ├── agent.ts          # Agent: stateful-диалог
    │   ├── strategy.ts       # SlidingWindow, StickyFacts, Branching
    │   ├── db.ts             # BlogDb: SQLite через node:sqlite (Node 24+)
    │   └── agents/           # блог-агенты
    │       ├── rss.ts        # парсинг RSS (sports.ru, championat.com, bbc.co.uk)
    │       ├── newsFetcher.ts    # Агент 1: выбор топа новостей
    │       ├── postWriter.ts     # Агент 2: написание поста (few-shot стиль)
    │       ├── factChecker.ts    # Агент 3: фактчекинг (JSON verdict)
    │       ├── pipeline.ts       # оркестратор: rss → 1 → 2 → 3
    │       └── seed.ts       # заливка образцов стиля в БД
    ├── data/
    │   └── style-samples.json    # 13 постов канала для few-shot
    └── demos/                # одно демо на день
        ├── types.ts          # интерфейс Demo { id, title, run }
        ├── registry.ts       # реестр всех демо
        ├── day-01.ts ... day-10.ts
        └── day-NN.ts         # новые дни добавлять тут (через ветку day-NN)
```

## Хранение контекста

| Где                 | Что хранится                                    | Технология        |
|---------------------|-------------------------------------------------|-------------------|
| REPL (в памяти)     | история диалога, стратегия контекста, usage     | RAM (in-process)  |
| demo `day-07.ts`    | история диалога одного дня                      | JSON-файл         |
| Блог-агенты         | новости, посты, образцы стиля, verdict'ы        | **SQLite**        |

SQLite — встроенный в Node 24 `node:sqlite`, без нативных сборок. Файл лежит
в `challenge/.data/blog.sqlite` (в `.gitignore`). Схема в `core/db.ts`:
таблицы `news` (UNIQUE по URL, чтобы не дублировать), `posts` (с FK на news
и verdict'ом фактчекинга), `style_samples` (UNIQUE по text).

## Запуск

Из корня репозитория:

```powershell
# по умолчанию: интерактивный чат-REPL с агентом:
pnpm --filter challenge start

# то же самое явно + стартовые опции:
pnpm --filter challenge start -- chat
pnpm --filter challenge start -- chat --strategy sliding
pnpm --filter challenge start -- chat --system "Ты суровый код-ревьюер"

# прогнать демо дня как один сценарий (для видео):
pnpm --filter challenge start -- day-03
pnpm --filter challenge start -- latest

# список всех демо:
pnpm --filter challenge start -- list
```

### Команды внутри REPL

| Команда                   | Что делает                                                  |
|---------------------------|-------------------------------------------------------------|
| `/help`                   | список команд                                               |
| `/list`                   | все доступные дни                                           |
| `/day <id>`               | показать заголовок дня                                      |
| `/strategy <name>`        | `full` / `sliding` / `sticky` / `branching` (reset истории) |
| `/system <text>`          | сменить system-промпт (reset истории)                       |
| `/branch <label>`         | новая ветка от текущего чекпойнта (только в branching)      |
| `/switch <id>`            | переключиться на ветку (только в branching)                 |
| `/branches`               | список веток (только в branching)                           |
| `/reset`                  | очистить историю, стратегию, usage                          |
| `/usage`                  | накопленные токены                                          |
| `/quit`                   | выход (также Ctrl+D)                                        |

Просто печатаете текст — отправляется в LLM через активную стратегию контекста.

## Блог-агенты: news pipeline

Три агента в одной команде готовят пост для канала «Иди на факты глянь»:

1. **Агент 1 (NewsFetcher)** — парсит RSS (sports.ru, championat.com, BBC Sport),
   фильтрует свежие, через LLM выбирает top-K хайповых (Челси, АПЛ, ЧМ, топ-игроки).
2. **Агент 2 (PostWriter)** — пишет пост в стиле канала, используя 5 случайных
   образцов из `style_samples` как few-shot. Резкий тон, CAPS для акцентов,
   риторика, эмодзи, шапка «Иди на факты глянь:», подпись `@lookatfacts`.
3. **Агент 3 (FactChecker)** — сверяет факты поста с источником (имена, клубы,
   счета, цитаты), выдаёт `verdict: ok | needs_revision` + список issues.

### Первичная инициализация (один раз)

```powershell
# Залить 13 образцов стиля вашего канала в БД:
pnpm --filter challenge start -- seed-style

# Проверить содержимое БД:
pnpm --filter challenge start -- db-stats
```

### Прогон pipeline

```powershell
# по умолчанию: за последние 24 часа, топ-5, пост про самую хайповую:
pnpm --filter challenge start -- news

# свои параметры:
pnpm --filter challenge start -- news --hours 48 --top 3
pnpm --filter challenge start -- news --for 1   # пост про новость №2 из топа
```

В конце печатается: топ-новости (агент 1), готовый пост (агент 2), отчёт
фактчекинга с issues (агент 3). Пост и verdict сохраняются в БД, новость
помечается `used=1`, чтобы в следующий раз её не брать повторно.

### Автоматизация (cron)

Запускайте pipeline каждый день в 10:00.

**Windows (Task Scheduler):**
```powershell
# Однократно: создать задачу
$action = New-ScheduledTaskAction `
  -Execute "C:\Program Files\nodejs\pnpm.cmd" `
  -Argument "--filter challenge start -- news" `
  -WorkingDirectory "E:\IT\alex-glad-challenge"
$trigger = New-ScheduledTaskTrigger -Daily -At 10am
Register-ScheduledTask -TaskName "blog-agents-daily" -Action $action -Trigger $trigger

# Удалить при необходимости:
# Unregister-ScheduledTask -TaskName "blog-agents-daily" -Confirm:$false
```

**Linux / macOS (crontab):**
```bash
# Открыть crontab:
crontab -e

# Добавить строку (каждый день в 10:00 по времени сервера):
0 10 * * * cd /path/to/alex-glad-challenge && /usr/bin/pnpm --filter challenge start -- news >> /var/log/blog-agents.log 2>&1
```

## Как добавить новый день

**Главный принцип:** день — это ветка, которая дорабатывает монолит.

1. Создать ветку от `main`:
   ```powershell
   git checkout main
   git pull
   git checkout -b day-NN
   ```
2. Создать файл `challenge/src/demos/day-NN-name.ts` с экспортом `demo: Demo`:
   ```ts
   import type { Demo } from './types.js';
   async function run(): Promise<void> { /* ... */ }
   export const demo: Demo = { id: 'day-NN', title: '...', run };
   ```
3. Зарегистрировать в `challenge/src/demos/registry.ts` (одна строка `import`
   + добавить в массив `demos`).
4. При необходимости — доработать `core/` (например, добавить function-calling
   в `client.ts`, новую стратегию в `strategy.ts` и т.п.).
5. Обновить `CHANGELOG.md` в корне репозитория: полный текст задания, что
   сделано, какие выводы.
6. Проверить: `pnpm --filter challenge typecheck`, запустить свой день через CLI.
7. Коммит, push, PR `day-NN -> main`. После ревью — squash-merge.

После мерджа ветки новый день автоматически появляется в `pnpm start -- list`
и доступен через CLI — никаких отдельных папок и package.json.

См. также [`AGENTS.md`](../AGENTS.md) в корне репозитория.
