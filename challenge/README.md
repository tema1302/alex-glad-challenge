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
# список всех демо:
pnpm --filter challenge start -- list

# конкретный день:
pnpm --filter challenge start -- day-03

# последний добавленный день:
pnpm --filter challenge start
pnpm --filter challenge start -- latest
```

Или напрямую через `tsx` (из папки challenge/):

```powershell
cd challenge
pnpm exec tsx src/cli.ts day-03
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
