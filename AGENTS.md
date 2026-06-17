# AGENTS.md — инструкции для ИИ-ассистентов

Этот файл — контракт для любого ИИ-ассистента (Droid, Claude, Copilot и т.п.),
работающего с этим репозиторием. Прочитайте перед любыми изменениями.

## Цель проекта

Репозиторий — выполнение челленджа по LLM: понять, как нейросеть работает изнутри,
какие у неё есть тонкие настройки, как управлять контекстом, агентом, ветками
диалога. Каждый день — отдельное маленькое задание, демонстрирующее конкретный
механизм LLM (температура, токены, стратегии контекста и т.п.).

## Структура

- `1-day/` … `10-day/` — **архив**. Старые задания, написанные как фрагменты
  Next.js/React-приложения на TypeScript. **Не трогать и не модифицировать.**
  Они оставлены как исторический архив; в новой разработке не участвуют.
- `challenge/` — **TypeScript workspace**. Все новые задания делаются тут.
  Внутри — общий пакет `@challenge/core` и один пакет на день в `challenge/days/`.
- `.env.example` — переменные окружения для API-ключей.
- `README.md` — обзор проекта для людей.
- `CHANGELOG.md` — лог по каждому дню.
- `AGENTS.md` — этот файл.

## Стек

- **Runtime:** Node.js 24+.
- **Язык:** TypeScript (strict).
- **Менеджер пакетов:** pnpm 10+ (workspaces).
- **Запуск:** `tsx` напрямую, без отдельного шага сборки.
- **HTTP:** встроенный `fetch` (Node 22).
- **Env:** `dotenv` (импортируется в `@challenge/core`).
- **Провайдеры:** DeepSeek и OpenRouter (OpenAI-совместимый `/chat/completions`).

## Конвенции

1. **Не менять** `1-day/` … `10-day/`. Это архив.
2. **Каждый день = отдельный пакет** в `challenge/days/day-NN-name/`, использует
   общий `@challenge/core` (`import { LlmClient, msg } from '@challenge/core'`).
   Не дублировать HTTP-логику в днях.
3. **ESM-модули.** Все `package.json` содержат `"type": "module"` и
   `"private": true`. В импортах внутри `core/src/` использовать расширение
   `.js` (ESM-конвенция для ts → js, даже если файлы `.ts`).
4. **Сообщения коммитов** — обычный текст с префиксом `day-NN:` (например,
   `day-11: add function-calling demo`).
5. **Документация** — в `CHANGELOG.md` добавляем запись для каждого дня:
   что сделано, какие выводы, ссылка на код. Обновляем `README.md` при необходимости.
6. **Git-ветвление:** одна ветка на день (`day-11`, `day-12`, …) от `main`,
   слияние через PR. См. раздел ниже.
7. **Секреты в коде запрещены.** API-ключи — только через `dotenv` и `.env`
   (который не коммитится; `.env` уже в `.gitignore`).
8. **Перед коммитом** запускать из корня репозитория:
   ```powershell
   pnpm typecheck
   ```
   Должно быть без ошибок.
9. **Комментарии в коде** — минимальные, только где не очевидно. Тексты
   промптов и заданий — в комментариях в начале `index.ts` каждого дня.

## Git-стратегия (для дня 11+)

- `main` — стабильная ветка, всегда проходит typecheck.
- `day-NN` — рабочая ветка для конкретного дня. Создаётся от `main`.
- После готовности дня — PR `day-NN -> main`, ревью, squash-merge.
- Коммиты в ветке `day-NN` — любые, при squash получим один чистый коммит.

```powershell
git checkout main
git pull
git checkout -b day-11
# ...работа...
git add -A
git commit -m "day-11: add function-calling demo"
git push -u origin day-11
# открыть PR
```

## Запуск заданий

```powershell
# один раз:
pnpm install
Copy-Item .env.example .env   # заполнить ключи

# запуск конкретного дня:
pnpm --filter day-01-first-request start
pnpm --filter day-10-strategies start -- sticky

# typecheck по всему репо:
pnpm typecheck
```

## Типичный паттерн нового дня

```ts
import { LlmClient, msg } from '@challenge/core';

async function main(): Promise<void> {
  const client = new LlmClient();
  const answer = await client.chat([msg.user('...')]);
  console.log(answer);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```
