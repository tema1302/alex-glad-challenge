# AGENTS.md — инструкции для ИИ-ассистентов

Этот файл — контракт для любого ИИ-ассистента (Droid, Claude, Copilot и т.п.),
работающего с этим репозиторием. Прочитайте перед любыми изменениями.

## Цель проекта

Репозиторий — выполнение челленджа по LLM: понять, как нейросеть работает
изнутри, какие у неё есть тонкие настройки, как управлять контекстом, агентом,
ветками диалога. Каждый день — отдельное маленькое задание, демонстрирующее
конкретный механизм LLM (температура, токены, стратегии контекста и т.п.).

## Архитектура: монолит + ветки на день

Ключевая идея: **одна кодовая база, которую дорабатываем ветками**. Не плодим
папки и подпакеты — каждый день расширяет единый монолит `challenge/`.

- `main` — стабильная ветка с актуальным монолитом. Всегда проходит typecheck.
- `day-NN` — рабочая ветка для конкретного дня. Создаётся от `main`, дорабатывает
  монолит, вливается обратно через PR (squash-merge).
- После мерджа новый день автоматически доступен через CLI.

## Структура

- `1-day/` … `10-day/` — **архив**. Старые задания как фрагменты Next.js/
  React-приложения. **Не трогать и не модифицировать.**
- `challenge/` — **монолит**. Единый пакет, один CLI, все дни как демо-модули.
  - `src/cli.ts` — точка входа (`pnpm --filter challenge start -- <command>`).
  - `src/core/` — общая библиотека: `LlmClient`, типы, `Agent`, стратегии
    контекста. Переиспользуется всеми демо.
  - `src/demos/` — одно демо на день (`day-NN.ts`), регистрируется в
    `registry.ts`.
- `.env.example` — переменные окружения для API-ключей.
- `README.md` — обзор проекта для людей.
- `CHANGELOG.md` — лог по каждому дню (полный текст задания + выводы).
- `AGENTS.md` — этот файл.

## Стек

- **Runtime:** Node.js 24+.
- **Язык:** TypeScript (strict, ESM).
- **Менеджер пакетов:** pnpm (один workspace, один пакет `challenge/`).
- **Запуск:** `tsx` напрямую, без отдельного шага сборки.
- **HTTP:** встроенный `fetch` (Node 24).
- **Env:** `dotenv` (импортируется в `src/core/client.ts`).
- **Провайдеры:** DeepSeek и OpenRouter (OpenAI-совместимый `/chat/completions`).

## Конвенции

1. **Не менять** `1-day/` … `10-day/`. Это архив.
2. **Один пакет `challenge/`.** Никаких вложенных `package.json`, никаких
   отдельных подпапок-пакетов на день. Все депсы — в `challenge/package.json`.
3. **Каждый день = модуль `src/demos/day-NN.ts`**, экспортирует
   `demo: Demo` и регистрируется в `src/demos/registry.ts`. Запускается через
   CLI `pnpm --filter challenge start -- day-NN`.
4. **Демонстрационные сценарии — неинтерактивные.** REPL-циклы не лечат в CLI
   по умолчанию (ломают воспроизводимость). Используйте заготовленные сценарии
   из массива `turns`. Если нужен интерактив — добавьте флаг `--interactive`.
5. **Общий код — в `src/core/`.** Если логика повторяется между демо или
   планируется к переиспользованию в будущих днях, положите её в `core/`.
   Например, `Agent` (day 6+) и стратегии контекста (day 10+) уже там.
6. **ESM.** Все импорты внутри `src/` используют расширение `.js`
   (ESM-конвенция для ts → js, даже если файлы `.ts`).
7. **Сообщения коммитов** — с префиксом `day-NN:` (например,
   `day-11: add function-calling demo`).
8. **Документация** — в `CHANGELOG.md` добавляем запись для каждого дня:
   полный текст задания, что сделано, какие выводы. Обновляем `README.md`
   при необходимости.
9. **Секреты в коде запрещены.** API-ключи — только через `dotenv` и `.env`
   (`.env` уже в `.gitignore`).
10. **Перед коммитом** запускать из корня:
    ```powershell
    pnpm --filter challenge typecheck
    ```
    Должно быть без ошибок.
11. **Комментарии в коде** — минимальные, только где не очевидно. Полный текст
    задания — в шапке-комментарии демо и в `CHANGELOG.md`.

## Git-стратегия

- `main` — стабильная ветка, всегда проходит typecheck.
- `day-NN` — рабочая ветка для конкретного дня. Создаётся от `main`.
- После готовности дня — PR `day-NN -> main`, ревью, squash-merge.

```powershell
git checkout main
git pull
git checkout -b day-11
# ...работа...
pnpm --filter challenge typecheck
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

# CLI:
pnpm --filter challenge start -- list           # список всех дней
pnpm --filter challenge start -- day-03         # конкретный день
pnpm --filter challenge start                   # последний добавленный
```

## Типичный паттерн нового дня

```ts
// challenge/src/demos/day-NN.ts
import { LlmClient, msg } from '../core/index.js';
import type { Demo } from './types.js';

async function run(): Promise<void> {
  const client = new LlmClient();
  const answer = await client.chat([msg.user('...')]);
  console.log(answer);
}

export const demo: Demo = {
  id: 'day-NN',
  title: 'Название темы',
  run,
};
```

И одна строка в `registry.ts`:
```ts
import { demo as dayNN } from './day-NN.js';
// ...
export const demos: ReadonlyArray<Demo> = [
  // ...,
  dayNN,
];
```
