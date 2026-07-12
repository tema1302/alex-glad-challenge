# ПРОМПТ: Развертывание alex-glad-challenge на сервере + production-деплой `web/`

> Самодостаточный промпт для Claude-сессии (оркестратор). Скармливать целиком.
> Артефакт на выходе: `docs/HERMES-DEPLOY-RUNBOOK.md` — исполняемый рукабук для
> оператора **Hermes**. Рукабук коммитится в репо и отдается Hermes пошагово
> выполнять.

---

## 0. Роль и цель

Ты — **оркестратор (Tech Lead)**. Не пишешь код сам в этой задаче (кроме финального
рукабука). Запускаешь **панель экспертов параллельно** через `Agent`/`subagent_type`,
каждый анализирует свою зону, затем **синтезируешь** их вывод в единый
`docs/HERMES-DEPLOY-RUNBOOK.md`.

**Цель рукабука:** оператор Hermes, действуя строго по нему, ставит всю систему на
сервер (где уже много чего крутится) и успешно билдит + деплоит сайт. Рукабук =
**линейная последовательность исполняемых команд** с verify-гейтами, откатами и
security-чеклистом. Не эссе, не «рекомендации» — **исполняемая инструкция**.

**Язык всего вывода — русский** (коммиты, рукабук, репорты экспертов).

---

## 1. Что разворачиваем (зафиксированные факты из репо — НЕ галлюцинировать)

### 1.1. pnpm-workspace (2 пакета-сиблинга)

- `challenge/` — монолит Node.js + TypeScript: CLI, агенты, LLM-клиент, блог-pipeline,
  Telegram, RSS, MCP-серверы, RAG. Запуск через `tsx` напрямую, **шага сборки НЕТ**.
- `web/` — Next.js 15 (App Router) + React 19, dashboard/витрина поверх
  `challenge/core`. Scoped override (единственное исключение из «Web-фронта НЕТ»).

### 1.2. Команды (фактические `package.json`)

| Пакет | Скрипт | Команда | Статус |
|---|---|---|---|
| `challenge/` | `start` | `tsx src/cli.ts` | есть |
| `challenge/` | `typecheck` | `tsc --noEmit` | есть |
| `challenge/` | `build` | — | **НЕТ (by design, tsx)** |
| `web/` | `dev` | `next dev -H 127.0.0.1` | есть |
| `web/` | `typecheck` | `tsc --noEmit` | есть |
| `web/` | `build` | — | **НЕТ — гэп №1** |
| `web/` | `start` | — | **НЕТ — гэп №1** |

### 1.3. `web/next.config.ts` (фактическое)

- `transpilePackages: ['challenge']` — TS-исходники `challenge/src` компилируются SWC
  как часть графа `web`.
- `outputFileTracingRoot: path.resolve(__dirname, '..')` — repo root для file-tracing.
- `serverExternalPackages`: `telegram`, `undici`, `socks`, `https-proxy-agent`,
  `websocket`, `fast-xml-parser`, `qrcode` (нативные/тяжёлые — вне server-bundle).
- `webpack.resolve.extensionAlias`: `.js → [.ts, .tsx, .js]` (challenge/ ESM с
  `.js`-спецификаторами импорта при `verbatimModuleSyntax`).
- **CSP strict:** `default-src 'self'; script-src 'self'; connect-src 'self';
  style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'self';
  frame-ancestors 'self'`.
- **`output: 'standalone'` — ОТСУТСТВУЕТ — гэп №2.** CLAUDE.md декларирует standalone
  для production. Рукабук обязан разрешить это противоречие явным решением.

### 1.4. Server-only chokepoint (критично, нельзя сломать)

- `web/lib/server/challenge.ts` — **единственный** легальный путь импорта
  `@challenge/core/*` в `web/`. Защищён пакетом `server-only` — client-компонент
  физически не сможет его импортнуть (компилятор Next упадёт).
- Client импортирует только из `web/lib/shared/*` (типы/схемы). **НИКОГДА из `core/`.**

### 1.5. Секреты и env (источник — `challenge/src/core/env.ts`)

Загрузка: `loadEnvUpward()` — ищет `.env` вверх от cwd до 6 уровней. Единая точка
чтения — typed-accessors; значения НЕ попадают в error/логи.

| Переменная | Назначение | Обязательность |
|---|---|---|
| `DEEPSEEK_API_KEY` | cloud-LLM (приоритет) | 1 из 2 cloud |
| `DEEPSEEK_MODEL` | модель (def `deepseek-chat`) | нет |
| `OPENROUTER_API_KEY` | cloud-LLM (fallback) | 1 из 2 cloud |
| `OPENROUTER_MODEL` | модель | нет |
| `LOCAL_LLM_BASE_URL` / `LOCAL_LLM_MODEL` / `LOCAL_LLM_API_KEY` | Ollama-LLM (RAG/chat) | для local-режима |
| `LOCAL_EMBED_BASE_URL` / `LOCAL_EMBED_MODEL` / `LOCAL_EMBED_API_KEY` | Ollama-эмбеддинги (RAG) | для RAG |
| `TG_API_ID` / `TG_API_HASH` | MTProto userbot | для TG-scan |
| `TG_SESSION` | MTProto-сессия (либо `.data/tg-session.json`) | для TG-scan, **критична** |
| `TG_TUNNEL_HOST` / `TG_TUNNEL_PORT` | socat-туннель к TG DC (def `91.199.147.131:8081`) | для MTProto через прокси |
| `TG_TOPIC` | topicId по умолчанию | нет |
| `TG_BOT_TOKEN` / `TG_CHAT_ID` | Bot API (публикация) | для публикации |
| `MCP_AUTH_TOKEN` | bearer на MCP HTTP-серверах | для MCP |
| `PRIVATE_LLM_PORT` (def 3030) | порт приватного LLM-gateway (day-30) | нет |
| `PRIVATE_LLM_AUTH_TOKEN` | auth gateway (отдельный от MCP) | рекомендуется |
| `PRIVATE_LLM_RATE_RPS`/`_TPM`/`_MAX_CONCURRENCY`/`_MAX_CONTEXT_TOKENS` | лимиты gateway | нет |

### 1.6. Runtime-состояние (всё вне git, в `.data/`)

- `challenge/.data/blog.sqlite`, `todoDb`, `dialog.sqlite` (RAG), индексы RAG,
  `tg-session.json`, `memory.json`, profiles.
- SQLite через нативный `node:sqlite` (Node 24+). **WAL** для `web/`.
- Внешние SQLite-драйверы (`better-sqlite3`) **ЗАПРЕЩЕНЫ**.
- `.data/` и `.env` — **НИКОГДА в git**.

### 1.7. Внешние сервисы на сервере

- **Ollama** — local-LLM (`qwen3.5`-класс, см. memory про thinking-fix) + эмбеддинги.
- **Telegram MTProto** (gramjs userbot) — требует прокси/туннель к DC (socat на
  `TG_TUNNEL_HOST:PORT`), либо прямой маршрут.
- **Telegram Bot API** — `TG_BOT_TOKEN` для публикации.
- **HTTP-MCP-серверы in-repo** (`core/mcp*`) + **Mobile MCP** (`claude-in-mobile` в
  `.mcp.json` — для оркестратора, НЕ для сервера-продакшена).
- Тулчейн: **Node.js 24+, pnpm 10.x**.

### 1.8. `onlyBuiltDependencies` (pnpm 10)

`bufferutil`, `es5-ext`, `esbuild`, `utf-8-validate` — разрешённые postinstall-build.
Без этого pnpm блокирует build-скрипты нативных опциональных зависимостей.

---

## 2. Найденные гэпы (рукабук обязан разрешить каждый)

1. **`web/package.json` без `build`/`start`.** Решение: добавить скрипты ИЛИ в рукабуке
   вызывать `next build`/`next start` напрямую. Обосновать выбор.
2. **`next.config.ts` без `output: 'standalone'`.** Решение: добавить флаг (для
   production-tracing на сервере) ИЛИ собирать в режиме без standalone. CLAUDE.md
   требует standalone — рукабук должен привести конфиг в соответствие.
3. **Win-dev → Linux-server.** Проверить: хардкод Windows-путей, CRLF/LF в скриптах,
   `.cmd`/`.ps1` в `.mcp.json` (на сервере нужен `npx`, не `npx.cmd`).
4. **Свежий сервер = пустой `.data/`.** Указать первичную инициализацию:
   `seed-style`, создание SQLite при первом запуске, миграции (если есть).
5. **Сосуществование.** На сервере уже заняты порты/сервисы — зондинг ДО установки.
6. **MTProto-сессия.** Как переносить `TG_SESSION`/`tg-session.json` — не логировать,
   не в git, не субагентам.
7. **Публичный доступ к `web/`.** Loopback-bind + reverse-proxy (nginx/Caddy) с TLS и
   basic-auth, либо edge. **Голый `0.0.0.0` без auth — триггер обязательного возражения.**

---

## 3. Security-инварианты (CLAUDE.md, STRICT — эксперт не вправе нарушать)

- Секреты — **только `.env`** (через `core/env.ts` / `web/lib/server/env.ts`). Никогда в
  коде/коммите/логе/промпте/MCP-интерфейсе/аргументах.
- `web/` production: **bind `127.0.0.1`**, публичный доступ — **только** через
  reverse-proxy (nginx/Caddy, TLS + basic-auth) или edge-провайдер с auth.
  `next start -H 0.0.0.0` без reverse-proxy = СТОП.
- **`NEXT_PUBLIC_*` секретов НЕТ.** Наружу — только флаги наличия (`Boolean`).
- **server-only chokepoint** сохранять. Проверка после сборки:
  `grep -rl "telegram\|TG_SESSION\|DEEPSEEK_API_KEY" web/.next/static` → **0 совпадений**.
- **SQL parameterized** (`?`-плейсхолдеры), без строковой интерполяции.
- **CSP `'self'`** не ослаблять (внешние fetch к Ollama/TG — с сервера, не из браузера).
- `fetch` по tainted-URL (RSS/LLM/ввод) — только через allowlist хостов; блокировка
  localhost/`127.0.0.1`/RFC1918/`169.254`/`metadata.google.internal`.
- MTProto-сессия (`TG_SESSION`) — не в лог/промпт/субагента без необходимости.
- MCP HTTP-серверы — `bind 127.0.0.1` + auth.
- `.env`, `.data/` (всех пакетов), `web/.next/` (включая `standalone/`),
  `web/.env.local`, `web/node_modules/` — в `.gitignore`, не в коммит.

---

## 4. Панель экспертов (параллельный анализ через `Agent`)

Запустить **5 экспертов одновременно** (по одному `Agent`-вызову на каждого, модель по
правилу CLAUDE.md: opus — Research/Plan, sonnet — ревью). Каждый пишет артефакт в
`./swarm-report/hermes-deploy-<role>-research.md` и возвращает сводку оркестратору.

### 4.1. DevOps-инфраструктурщик (opus)
**Зона:** топология сервера, сосуществование, системные юниты, reverse-proxy, TLS.
**Вопросы:**
- Как зондируется сервер ДО установки (занятые порты, установленные Node/pnpm/nginx/
  Caddy/Ollama, disk, RAM, OS, firewall)?
- Где разместить repo, `.env`, `.data/`, логи (FHS: `/opt`/`/srv`, юзер без sudo)?
- systemd-юниты для: long-running `web/` (`next start`), MCP/PRIVATE_LLM-gateway,
  Ollama (если локально), TG-scan по cron/таймеру.
- Reverse-proxy (nginx ИЛИ Caddy) с TLS (Let's Encrypt) + basic-auth → loopback `web/`.
- Конфликт портов с тем, что уже на сервере.
**Артефакт:** `./swarm-report/hermes-deploy-devops-research.md`.

### 4.2. Build/Deploy-инженер Next.js (opus)
**Зона:** сборка `web/` standalone, file-tracing, transpilePackages, запуск.
**Вопросы:**
- Решение по гэпам №1 (build/start-скрипты) и №2 (`output: 'standalone'`).
- Как собирается workspace с `transpilePackages:['challenge']` на Linux-сервере.
- `outputFileTracingRoot` — переносится ли корректно на Linux-пути.
- Что входит в standalone-артефакт, куда класть `.next/standalone`, нужен ли
  `node_modules` challenge/ рядом.
- Команды сборки и smoke-запуска на loopback, HTTP 200 на ключевых маршрутах.
**Артефакт:** `./swarm-report/hermes-deploy-build-research.md`.

### 4.3. Backend/runtime-инженер challenge/ (opus)
**Зона:** runtime `challenge/` на сервере, SQLite, Ollama, Telegram, MCP-gateway.
**Вопросы:**
- Запуск CLI через `tsx` на сервере (зависимости, `onlyBuiltDependencies`).
- Инициализация `.data/` с нуля (`seed-style`, миграции, WAL).
- Ollama: модели (LLM + embed), pull, проверка endpoint, объём RAM/диска.
- Telegram MTProto: перенос `TG_SESSION`, туннель (`TG_TUNNEL_HOST`),
  socks/https-proxy-agent, валидация без утечки сессии.
- PRIVATE_LLM-gateway (порт 3030) и MCP HTTP-серверы — bind, auth, проверка.
- CLI-верификация: `list`, `latest`, `db-stats`, `news`, `chat`.
**Артефакт:** `./swarm-report/hermes-deploy-backend-research.md`.

### 4.4. Security-инженер (sonnet, code-reviewer)
**Зона:** все инварианты раздела 3 применённые к конкретному плану.
**Вопросы:**
- Аудит穿透ения server-only chokepoint при сборке; client-bundle grep = 0.
- .env-гигиена, отсутствующие `NEXT_PUBLIC_*` секреты.
- Reverse-proxy hardening (TLS, headers, basic-auth, rate-limit, no `0.0.0.0`).
- SSRF-allowlist для RSS/TG/LLM-fetch.
- Чек-лист «до/после деплоя» по security-чеклисту из шаблона Report.
**Артефакт:** `./swarm-report/hermes-deploy-security-research.md`.

### 4.5. Hermes-execution-планировщик (sonnet)
**Зона:** превращает вывод 1–4 в линейный рукабук для человека-оператора.
**Вопросы:**
- Разбиение на фазы (Зонд → Подготовка → Установка challenge/ → Сборка web/ →
  Запуск services → Reverse-proxy/TLS → Smoke → Пост-деплой).
- Каждая команда — исполняемая, с путями/портами из фактов, с verify-гейтом после.
- Rollback на каждой фазе.
- Точки, где Hermes СТОП и спрашивает (секреты, публичный домен, MTProto-сессия).
- Формат: markdown, нумерованные шаги, блоки кода с командами bash (сервер — Linux).
**Артефакт:** `./swarm-report/hermes-deploy-exec-research.md`.

---

## 5. Синтез (оркестратор, после сбора всех 5 артефактов)

1. Прочитать все 5 файлов `./swarm-report/hermes-deploy-*-research.md`.
2. Свести в единый `docs/HERMES-DEPLOY-RUNBOOK.md` по структуре раздела 6.
3. Разрешить конфликты между экспертами (если есть) — зафиксировать решение с
   обоснованием в секции «Решения по гэпам».
4. Каждая команда рукабука — трассируется к фактам раздела 1 (никаких выдуманных
   портов/скриптов).
5. Прогнать self-review: code-reviewer-субагент читает рукабук и проверяет
   исполняемость + security-инварианты. Нашёл дыру → правка, повтор.

---

## 6. Структура финального `docs/HERMES-DEPLOY-RUNBOOK.md`

```markdown
# HERMES-DEPLOY-RUNBOOK — развёртывание alex-glad-challenge + деплой web/

## 0. Кому и как пользоваться
- Оператор: Hermes. Действовать строго сверху вниз. На каждой STOP-точке — пауза.
- ОС сервера: <детектить на Фазе 1>. Shell: bash.
- Все команды — исполняемые. После каждого блока — verify-гейт (НЕ пропускать).

## 1. Архитектура того, что ставим (краткая карта)
<challenge/ + web/, chokepoint, .data/, внешние сервисы — из фактов раздела 1>

## 2. Решения по гэпам (явные, с обоснованием)
- build/start-скрипты web/: <решение>
- output: 'standalone': <решение>
- Win→Linux: <проверки>
- инициализация .data/: <шаги>

## 3. Фаза 1 — Зонд сервера (ДО установки)
- [ ] OS / версия / arch: `uname -a`, `cat /etc/os-release`
- [ ] Node: `node -v` (нужен 24+). Нет → install (nvm/node-source).
- [ ] pnpm: `pnpm -v` (нужен 10.x). Нет → `corepack enable && corepack prepare pnpm@latest --activate`.
- [ ] Занятые порты: `ss -tlnp` (особенно 80, 443, 3000, 3030, 11434(Ollama)).
- [ ] nginx/Caddy: `nginx -v` / `caddy version`.
- [ ] Ollama: `ollama --version`, `curl -s http://127.0.0.1:11434/api/tags`.
- [ ] Git, disk (`df -h`), RAM (`free -h`).
- [ ] Firewall: `ufw status` / `iptables -L`.
- <верификация: таблица «что есть / чего нет / действие»>

## 4. Фаза 2 — Подготовка окружения
- Создание юзера/каталога (`/opt/alex-glad` или `/srv`), клонирование repo.
- Node 24+ / pnpm 10 — установка при отсутствии.
- <verify>

## 5. Фаза 3 — Секреты и .env
- Создать `.env` из `.env.example` (шаблон — минимальный набор для выбранного режима).
- Внести: <список с назначением, БЕЗ значений — Hermes вписывает сам>.
- `.data/` — создать, перенести `tg-session.json` (если есть) защищённо (scp из secrets,
  НЕ через git/лог).
- <verify: loadEnvUpward находит .env; `pnpm --filter challenge start -- db-stats`>

## 6. Фаза 4 — Установка challenge/
- `pnpm install` (workspace).
- `pnpm --filter challenge typecheck` — СТРОГО зелёный.
- `onlyBuiltDependencies` — проверить, что нативные опциональные собрались.
- Инициализация `.data/`: `pnpm --filter challenge start -- seed-style` (и др. по факту).
- CLI-smoke: `list`, `latest`, `db-stats`.
- <verify + rollback>

## 7. Фаза 5 — Внешние сервисы (Ollama, Telegram)
- Ollama: pull моделей (`LOCAL_LLM_MODEL`, `LOCAL_EMBED_MODEL`); verify endpoint.
- Telegram MTProto: проверка туннеля `TG_TUNNEL_HOST:PORT`; smoke TG-scan БЕЗ печати сессии.
- Bot API: проверка `TG_BOT_TOKEN`/`TG_CHAT_ID` (тестовое сообщение).
- <verify + точки СТОП при отсутствии секретов>

## 8. Фаза 6 — Сборка web/ (production standalone)
- Решение по гэпам №1/№2 применено (как именно — в командах).
- `pnpm --filter web typecheck` — зелёный ДО.
- `pnpm --filter web build` (standalone) — артефакт в `web/.next/standalone/`.
- <verify: артефакт существует, serverExternalPackages не в bundle>

## 9. Фаза 7 — Запуск web/ на loopback
- `next start` (или standalone-сервер) на `127.0.0.1:<PORT>`.
- systemd-юнит (long-running, restart=always, юзер без sudo, env-файл через
  `EnvironmentFile=`, NO секретов в юнит-файле открытым текстом — лучше из .env).
- smoke: `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:<PORT>/` → 200;
  ключевые маршруты (`/dashboard`, `/api/...`).
- <verify + rollback>

## 10. Фаза 8 — Reverse-proxy + TLS (публичный доступ)
- nginx ИЛИ Caddy (обосновать выбор) → `127.0.0.1:<PORT>`.
- TLS: Let's Encrypt (`certbot` / авто Caddy).
- basic-auth (htpasswd / Caddy basic-auth).
- Security-headers, rate-limit, gzip.
- **ЗАПРЕЩЕНО:** публиковать `0.0.0.0` без auth/TLS.
- <verify: HTTPS 200 снаружи, HTTP→HTTPS редирект, basic-auth срабатывает>

## 11. Фаза 9 — Пост-деплой проверки (Security-чеклист)
- [ ] typecheck challenge/ + web/ — зелёный
- [ ] client-bundle grep: `grep -rl "telegram\|TG_SESSION\|DEEPSEEK_API_KEY" web/.next/static` → 0
- [ ] секреты только в `.env`, не в коммите/логе
- [ ] SQL parameterized (audit точек записи)
- [ ] bind loopback на всех MCP/gateway/web
- [ ] `.data/` и `.env` — не в git
- [ ] MTProto-сессия не утекла
- [ ] fetch allowlist на месте
- [ ] reverse-proxy: TLS + auth, нет голого 0.0.0.0

## 12. Troubleshooting (типовые поломки → диагностика → фикс)
- `next build` падает на challenge/ts-импортах → extensionAlias/transpilePackages.
- SQLite не создаётся → права на `.data/`, WAL.
- Ollama timeout → модель не pulled / не хватает RAM.
- MTProto не коннектит → туннель/прокси.
- CSP рубит SSE → same-origin проверка.
- CSP рубит гидратацию dev (memory: `app/loading.tsx`) — в prod неактуально, но проверить.

## 13. Rollback (полный)
- Остановить systemd-юниты, откатить reverse-proxy, оставить challenge/ как было.

## 14. Открытые вопросы для Hermes (требуют человеческого решения)
- домен для TLS, выбор nginx/Caddy, перенос MTProto-сессии, бюджет RAM под Ollama.
```

---

## 7. Критерий приёмки (definition of done)

- `docs/HERMES-DEPLOY-RUNBOOK.md` существует, закоммичен, префикс коммита `day-30:`.
- Каждая команда исполняема, трассируется к фактам раздела 1 (нет выдуманных
  портов/скриптов/переменных).
- Гэпы №1–№7 раздела 2 — разрешены явными решениями с обоснованием.
- Все STOP-точки (секреты, домен, MTProto-сессия) — явно отмечены.
- Security-чеклист (Фаза 9) — полный, по инвариантам раздела 3.
- Self-review code-reviewer-субагента — зелёный.
- `next.config.ts`/`web/package.json` — приведены в соответствие с решением по гэпам
  (отдельный коммит, префикс `day-30:`), typecheck зелёный после правок.

---

## 8. Что НЕ делать (STRICT)

- Не публиковать `web/` на `0.0.0.0` без auth/TLS.
- Не хардкодить секреты в рукабуке/коммите/логе.
- Не прокидывать `TG_SESSION`/ключи в промпты/субагенты без необходимости.
- Не ослаблять CSP, не выносить секреты в `NEXT_PUBLIC_*`.
- Не добавлять внешний SQLite-драйвер.
- Не изобретать `pnpm test`/`lint`/`pnpm build` для challenge/ (их нет).
- Не коммитить `.env`, `.data/`, `web/.next/`.
- Не обходить хуки (`--no-verify`/`--force`) без явной просьбы пользователя.
