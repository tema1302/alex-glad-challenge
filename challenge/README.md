# challenge/ — монолит LLM-челленджа

Единая кодовая база для прохождения челленджа по LLM «изнутри». Все 10 дней
прошивания реализованы как демо-модули и запускаются через один CLI. Каждый
новый день — это доработка этого монолита в отдельной git-ветке (см.
[`AGENTS.md`](../AGENTS.md)).

## Структура

```
challenge/
├── package.json              # единый пакет
├── tsconfig.json             # локальный tsconfig
└── src/
    ├── cli.ts                # точка входа CLI
    ├── core/                 # общая библиотека
    │   ├── index.ts          # публичный API
    │   ├── client.ts         # LlmClient (OpenAI-совместимый HTTP)
    │   ├── types.ts          # ChatMessage, Usage, ChatParams, ...
    │   ├── agent.ts          # Agent: stateful-диалог
    │   └── strategy.ts       # SlidingWindow, StickyFacts, Branching
    └── demos/                # одно демо на день
        ├── types.ts          # интерфейс Demo { id, title, run }
        ├── registry.ts       # реестр всех демо
        ├── day-01.ts ... day-10.ts
        └── day-NN.ts         # новые дни добавлять тут (через ветку day-NN)
```

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
