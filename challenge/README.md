# challenge/ — TypeScript workspace

Воркспейс на TypeScript для прохождения челленджа по LLM «изнутри». Каждый день —
отдельный пакет, все они используют общий пакет [`@challenge/core`](core/) для
HTTP-запросов к OpenAI-совместимому Chat Completions API (DeepSeek, OpenRouter).

## Структура

```
challenge/
├── core/                              # общая либа: LlmClient, типы, стратегии
│   └── src/
│       ├── index.ts                   # публичные экспорты
│       ├── client.ts                  # HTTP-клиент
│       ├── types.ts                   # ChatMessage, Usage, и т.п.
│       └── strategy.ts                # Sliding/Sticky/Branching
└── days/
    ├── day-01-first-request/
    ├── day-02-format/
    ├── day-03-reasoning/
    ├── day-04-temperature/
    ├── day-05-models/
    ├── day-06-agent/
    ├── day-07-persistence/
    ├── day-08-tokens/
    ├── day-09-compression/
    └── day-10-strategies/
```

## Запуск

1. Установить зависимости один раз из корня репозитория:
   ```powershell
   pnpm install
   ```
2. Создать `.env` в корне:
   ```powershell
   Copy-Item .env.example .env
   # заполнить OPENROUTER_API_KEY или DEEPSEEK_API_KEY
   ```
3. Запустить конкретный день:
   ```powershell
   pnpm --filter day-01-first-request start
   pnpm --filter day-10-strategies start -- sticky
   ```
   Или напрямую через `tsx`:
   ```powershell
   pnpm exec tsx challenge/days/day-01-first-request/index.ts
   ```
4. Проверить типы:
   ```powershell
   pnpm typecheck
   ```

## Как добавлять новый день

1. Создать ветку `day-NN` от `main`.
2. Создать папку `challenge/days/day-NN-name/` с `package.json` и `index.ts`.
3. Использовать `@challenge/core` для HTTP:
   ```ts
   import { LlmClient, msg } from '@challenge/core';
   ```
4. Прописать её в `pnpm-workspace.yaml` — уже покрывается шаблоном `challenge/days/*`.
5. Обновить `CHANGELOG.md` в корне репозитория.
6. Commit, push, PR в `main`.

См. также [`AGENTS.md`](../AGENTS.md) в корне репозитория.
