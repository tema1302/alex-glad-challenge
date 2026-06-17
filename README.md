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

### 1. Установить Node.js 22+ и pnpm

**Windows (PowerShell):**
```powershell
# через winget (встроен в Windows 10/11):
winget install OpenJS.NodeJS.LTS
winget install pnpm.pnpm

# либо скачать установщики:
# Node.js:  https://nodejs.org/
# pnpm:     https://pnpm.io/installation
```

**macOS / Linux:**
```bash
# nvm (рекомендуется):
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
nvm install 22
nvm use 22

# pnpm:
corepack enable
corepack prepare pnpm@latest --activate
```

Проверка:
```powershell
node --version   # v22.x.x
pnpm --version   # 10.x.x
```

### 2. Клонировать репозиторий

```powershell
git clone <url-вашего-репозитория> alex-glad-challenge
cd alex-glad-challenge
```

### 3. Установить зависимости

```powershell
pnpm install
```

### 4. Настроить ключи LLM-провайдера

```powershell
Copy-Item .env.example .env
notepad .env   # или любой редактор
```

Заполнить одну из строк (или обе — OpenRouter имеет приоритет):
- `OPENROUTER_API_KEY=sk-or-...` — получить на https://openrouter.ai/keys (даёт
  доступ к десяткам моделей: OpenAI, Anthropic, Google, Meta и т.д.)
- `DEEPSEEK_API_KEY=sk-...` — получить на https://platform.deepseek.com/api_keys

### 5. Запустить день

```powershell
# конкретный день:
pnpm --filter day-01-first-request start

# или напрямую через tsx:
pnpm exec tsx challenge/days/day-01-first-request/index.ts

# день 10 принимает аргумент-стратегию:
pnpm --filter day-10-strategies start -- sticky
```

### 6. Проверить типы (опционально)

```powershell
pnpm typecheck
```

---

Подробности — в [`AGENTS.md`](AGENTS.md) (для ИИ-ассистентов) и в
[`challenge/README.md`](challenge/README.md). Полный текст задания каждого дня и
лог прохождения — в [`CHANGELOG.md`](CHANGELOG.md).
