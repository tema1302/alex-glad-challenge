# ADVANCED Day 13 — LLM Gateway (2026-11-04)

Учебный security-день: поднять прокси между пользователем и LLM, который
проверяет вход, ответ и всё пишет в audit-лог.

- **Input Guard:** секреты/ПДн во входящем промпте — блокировка или маскирование.
- **Output Guard:** сгенерированные секреты, утечка system prompt, опасные URL
  и команды в ответе модели.
- **Audit:** каждый запрос/ответ — JSONL, без сырых секретов.
- **Усиление:** rate limiting на IP и cost tracking по токенам.

Код: [`challenge/src/core/gateway/`](../../challenge/src/core/gateway/), CLI
`llm-gateway`. Артефакты: [`test-cases.md`](./test-cases.md),
[`live-run.md`](./live-run.md).

## Быстрый старт

Офлайн-матрица (не нужны ключи и сеть):

```text
pnpm --filter challenge start -- llm-gateway --self-test
```

Запуск прокси (провайдер берётся из `.env`: DeepSeek/OpenRouter → `openai`,
либо `ANTHROPIC_API_KEY` → `anthropic`):

```text
pnpm --filter challenge start -- llm-gateway --port 3040 --mode block --rate 30
```

Проверка и блокировка секрета:

```text
curl.exe -s -i http://127.0.0.1:3040/healthz
```

```text
curl.exe -s -i -X POST http://127.0.0.1:3040/v1/chat/completions -H "content-type: application/json" -d "{\"messages\":[{\"role\":\"user\",\"content\":\"key sk-proj-abc123\"}]}"
```

Ответ на секрет — `422`, upstream не вызывается.

## Архитектура

```text
client
  -> POST /v1/chat/completions
  -> rate limit (IP, N/мин)
  -> Input Guard (block | mask)
  -> upstream: OpenAI-compatible | Anthropic Messages
  -> Output Guard (allow | redact | block)
  -> cost tracking
  -> audit.jsonl / intercepted.jsonl
  -> client
```

| Файл | Роль |
|---|---|
| `secrets.ts` | regex-детекторы ключей/ПДн, Luhn для карт, base64/split-нормализация, маскирование |
| `inputGuard.ts` | решение `allow` / `masked` / `blocked` до LLM |
| `outputGuard.ts` | проверка ответа: секреты, system prompt, URL, команды |
| `rateLimit.ts` | sliding-window N запросов/мин на IP |
| `cost.ts` | токены × прайс модели → USD |
| `auditLog.ts` | JSONL audit + intercepted, безопасные preview |
| `upstream.ts` | OpenAI Chat Completions и Anthropic Messages API |
| `server.ts` | node:http, `/v1/chat/completions`, `/healthz`, `/stats` |
| `cases.ts` | 14-кейсовая матрица для self-test и документации |

Новых зависимостей нет: `node:http`, `node:crypto`, нативный `fetch`/`netFetch`.

## Input Guard

| Что | Паттерн/правило | Severity | Пример |
|---|---|---|---|
| OpenAI/Anthropic key | `sk-…` (proj/ant/live/test или 20+ символов) | critical | `sk-proj-abc123` |
| GitHub token | `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_` + 16+ | critical | `ghp_…` |
| AWS access key | `AKIA`/`ASIA` + 16 заглавных | critical | `AKIAIOSFODNN7EXAMPLE` |
| Google key | `AIza…` | critical | — |
| Slack token | `xox[abprs]-…` | critical | — |
| JWT | три base64url-сегмента | high | — |
| Bearer | `Bearer <token>` (токен маскируется, слово остаётся) | critical | — |
| Private key | `-----BEGIN … PRIVATE KEY-----` | critical | — |
| Email | стандартный regex | medium | `user@example.com` |
| Карта | 13–19 цифр + **Luhn** | high | `4111 1111 1111 1111` |
| Телефон | `+7`/`8` и международный формат | medium | `+7 (999) 123-45-67` |
| Base64-секрет | base64-токен декодируется и пересканируется | как внутренний | `c2stcHJvai1hYmMxMjM=` |
| Разбитый секрет | `"sk-" + "proj-abc123"` нормализуется и сканируется | как внутренний | — |

Режимы:

- `block` (default): любая находка → `422`, upstream **не вызывается**;
- `mask`: значения заменяются маркерами (`[REDACTED_API_KEY]`,
  `[REDACTED_CARD]`, …), запрос уходит в LLM.

Наружу и в лог отдаются только `kind`, `severity`, `preview` (`sk-p***23`).
Сырые значения не попадают ни в ответ, ни в audit, ни в intercepted-лог.

## Output Guard

| Что | Действие |
|---|---|
| Сгенерированный ключ/токен/карта | `blocked` (ответ заменяется безопасным warning) |
| Дословный system prompt или фраза раскрытия | `blocked` |
| Подозрительный URL: shortener, IP, punycode, `javascript:`/`data:`/`file:`, non-TLS, userinfo, нестандартный порт | `redacted` → `[SUSPICIOUS_URL]` |
| Опасная команда: `rm -rf /`, pipe-to-shell, `powershell -enc`, `chmod 777`, `os.system` | `redacted` → `[SUSPICIOUS_COMMAND]` |
| Email/телефон в ответе | `redacted` |

Обычный `https://nodejs.org/...` не трогается.

## Audit, rate limit, cost

- Audit: `challenge/.data/gateway/audit.jsonl` — статус, requestId, IP,
  provider/model, latency, findings, safe preview, usage, cost.
- Intercepted: `challenge/.data/gateway/intercepted.jsonl` — только
  `direction/kind/severity/preview`.
- Rate limit: `GATEWAY_RATE_LIMIT` (default 30/мин на IP), `429` + `Retry-After`.
- Cost: `usage` провайдера × прайс модели (`cost.ts`); если usage нет — оценка
  `TokenEstimator`. Прайсы ориентировочные, не биллинг.
- Эндпоинты: `GET /healthz`, `GET /stats`; ответы с `x-request-id`,
  `x-gateway-guard`, `x-gateway-cost-usd`, `x-ratelimit-remaining`.

Env (см. `.env.example`): `GATEWAY_PROVIDER`, `GATEWAY_PORT`,
`GATEWAY_RATE_LIMIT`, `GATEWAY_GUARD_MODE`, `GATEWAY_MODEL`,
`GATEWAY_UPSTREAM_URL`, `ANTHROPIC_*`.

## Ограничения (честно)

- Это эвристики, а не DLP: обфускация несколькими слоями base64, шифрование,
  картинки и стеганография не ловятся.
- Split-детектор понимает конкатенацию в кавычках через `+`; произвольные
  переменные/шаблоны не разворачиваются.
- 16 цифр без Luhn намеренно не считаются картой, чтобы не блокировать номера
  заказов (кейс `IN-09`).
- Output URL-политика консервативная: не-TLS и IP-литералы редактируются.
- Стриминг (`stream:true`) не проксируется; gateway отвечает целым JSON.
- Нет auth на самом gateway (bind только loopback). Наружу — только за
  TLS reverse-proxy с аутентификацией.
- Audit-файлы растут без ротации.

## Проверка

```text
pnpm --filter challenge typecheck
```

```text
pnpm --filter challenge test
```

```text
pnpm --filter challenge start -- llm-gateway --self-test
```

Фактический результат матрицы и разбор «поймали/пропустили» —
[`test-cases.md`](./test-cases.md). Runbook с curl и логами —
[`live-run.md`](./live-run.md).
