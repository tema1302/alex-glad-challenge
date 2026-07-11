# web — локальный Next.js (день 28)

Локальный dashboard и витрина поверх `challenge/core`. Часть pnpm-workspace
(`challenge` + `web`). **Только локально, 127.0.0.1, без production-build/deploy.**

## Запуск

Из корня репозитория:

```bash
pnpm install            # установить зависимости workspace (challenge + web)
pnpm --filter web dev   # поднять next dev
```

Откроется на `http://127.0.0.1:3000` (Next по умолчанию слушает loopback).

## Что есть в P0

- **`/` Dashboard** — счётчики БД (`challenge/.data`: news/posts/style/RAG-чанки/
  TG-сообщения/dialog-чаты) и статус ключей **без значений** (DeepSeek ✓/✗, OpenRouter,
  Local LLM, MTProto configured, Bot API) + активная модель.
- **`/showcase` Витрина** — возможности системы по модулям (RAG / Chat / Блог / TG /
  MCP / Memory) + схема архитектуры + стек. Функциональный обзор, не хронология дней.
- Тема dark-only (next-themes, `forcedTheme="dark"` — light-режима нет, переживает reload).
- 404 / error-состояния.

Разделы RAG / Chat / Блог / TG / MCP / Настройки — placeholder'ы («скоро»), появятся в P1+.

## Архитектура

```
web/app (Server/Client components, App Router)
        │
        ▼
web/lib/server/challenge.ts   ← ЕДИНСТВЕННЫЙ chokepoint импорта @challenge/core/*
        │  (import 'server-only' → не попадает в client bundle)
        ▼
challenge/src/core/*          ← доменная логика, БД-классы, env accessors
        │
        ▼
challenge/.data/*.sqlite      ← node:sqlite, WAL (вне git)
```

Ключи / `TG_SESSION` / MTProto (`telegram`) / `node:sqlite` — **только server-side**
(`web/lib/server/*` + Server Components + Route Handlers). Никаких `NEXT_PUBLIC_*`
секретов; client-компоненты импортируют только из `web/lib/shared/*` (типы/схемы).

`challenge/` **не правится** этой фазой (P0sec уже подготовил `core/paths.ts`,
`core/sanitize.ts`, env accessors, MCP bind). Пути к `.data` — cwd-независимы через
`core/paths.ts` (`import.meta.url`), работают и из CLI (`tsx`), и из web.

## Скрипты

| Команда | Назначение |
|---|---|
| `pnpm --filter web dev` | `next dev` (127.0.0.1:3000) |
| `pnpm --filter web typecheck` | `tsc --noEmit` (статический гейт) |

Lint / unit-тесты / build не настроены (инвариант проекта).
