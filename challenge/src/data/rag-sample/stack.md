# Стек проекта

Монолит `challenge/` для прохождения LLM-челленджа. Единая кодовая база, один CLI,
все дни как демо-модули.

## Runtime и язык

- **Runtime:** Node.js 24+. Использует нативный `fetch` и встроенный `node:sqlite`.
- **Язык:** TypeScript, strict-режим, ESM. Целевой `target` ES2022.
- **Импорты:** внутри `src/` используются расширения `.js` (ESM-конвенция).

## Пакетный менеджер

`pnpm` 10.28.0. Workspace состоит из единственного пакета `challenge/`. Вложенные
`package.json` запрещены — все зависимости в `challenge/package.json`.

## Запуск

Демо запускаются через `tsx` напрямую, без отдельного шага сборки. Точка входа —
`src/cli.ts`. Сборка (tsc emit, bundler) не используется.

## Провайдеры LLM

DeepSeek и OpenRouter — оба OpenAI-совместимы, эндпоинт `/chat/completions`.
Собственный клиент `LlmClient` живёт в `src/core/client.ts`. Ключи — только через
`.env` (`DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`).

## Хранилище

SQLite через `node:sqlite` (без нативных сборок). Файл `challenge/.data/blog.sqlite`.
Схема — в `src/core/db.ts`: таблицы `news`, `posts`, `style_samples`.
