# alex-glad-challenge

Челлендж «как LLM работает изнутри». Дневник прохождения курса, по одному
заданию в день. Каждое задание — отдельный маленький эксперимент над LLM:
температура, токены, стратегии контекста, ветки диалога, агенты и т.п.

## Стек

- **Дни 1–10 (архив):** фрагменты Next.js/React-приложения на TypeScript.
  Лежат в `1-day/` … `10-day/`. Оставлены как историческая ссылка, не используются
  в новой разработке.
- **Дни 1–10 (TS-порт):** те же концепции переписаны как автономные скрипты в
  `challenge/` (pnpm workspace). Это актуальная версия для разбора и видео.
- **День 11+:** все новые задания — в `challenge/days/day-NN-name/`.

Runtime: Node.js 22+, TypeScript, pnpm workspaces. API: DeepSeek и OpenRouter
(модельный зоопарк). Ключи — через `.env`, см. `.env.example`.

## Что уже разобрано

| День | Тема | Где смотреть |
|------|------|--------------|
| 1 | Первый запрос к LLM через API | `challenge/days/day-01-first-request/` |
| 2 | Формат ответа (без ограничений / JSON / stop) | `challenge/days/day-02-format/` |
| 3 | Способы рассуждения (прямой / пошаговый / мета / эксперты) | `challenge/days/day-03-reasoning/` |
| 4 | Температура (0 / 0.7 / 1.2) | `challenge/days/day-04-temperature/` |
| 5 | Сравнение версий моделей | `challenge/days/day-05-models/` |
| 6 | Первый агент | `challenge/days/day-06-agent/` |
| 7 | Сохранение контекста в JSON | `challenge/days/day-07-persistence/` |
| 8 | Подсчёт токенов | `challenge/days/day-08-tokens/` |
| 9 | Сжатие истории через summary | `challenge/days/day-09-compression/` |
| 10 | Sliding / Sticky / Branching | `challenge/days/day-10-strategies/` |

## Быстрый старт

```powershell
# 1. Установить зависимости:
pnpm install

# 2. Положить ключи:
Copy-Item .env.example .env
# заполнить OPENROUTER_API_KEY или DEEPSEEK_API_KEY

# 3. Запустить день:
pnpm --filter day-01-first-request start
```

Подробности — в [`AGENTS.md`](AGENTS.md) (для ИИ-ассистентов) и в
[`challenge/README.md`](challenge/README.md). Лог по дням — в
[`CHANGELOG.md`](CHANGELOG.md).
