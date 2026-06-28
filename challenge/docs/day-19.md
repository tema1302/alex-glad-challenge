# День 19 — Композиция MCP-инструментов: скан чата Telegram агентом

Юзер пишет запрос в REPL/CLI → агент сам гонит цепочку MCP-тулов на едином живом
сервере (api.memo7.ru): `scan_chat_messages → analyze_messages → send_to_chat`.
Это НЕ демка с авто-прогоном: триггер всегда юзер.

> Задание дня: несколько MCP-инструментов, пайплайн «получить → обработать →
> сохранить/отправить», проверка авто-выполнения цепочки и передачи данных.

---

## Почему так

- **Один MCP-сервер.** Инструменты добавлены в `day-18-server.ts` (= api.memo7.ru),
  отдельный день-сервер не поднимается.
- **Без демки.** Нет `demos/day-19.ts` с авто-`run()`. Вход даёт юзер (`/agent`
  или `start -- agent`), дальше действует агент.
- **Чтение истории = MTProto.** Bot API не умеет читать чужую историю — только
  сообщения, пришедшие боту. Поэтому скан через userbot (api_id/api_hash/session),
  отправка отчёта — через Bot API (`publishPost`).
- **Обработка детерминированная.** `analyze_messages` — чистая функция (счёт
  авторов/терминов/ссылок), без LLM. Сервер остаётся независимым от модели.

---

## Архитектура

```
Юзер вводит запрос (REPL /agent  или  start -- agent "<запрос>")
        │
        ▼
 runAgentRequest → runAgentLoop (core/mcpAgentLoop.ts)
   LLM сама выбирает тулы в цикле CALL/RESULT, до 6 итераций
        │  HTTP POST JSON-RPC 2.0
        ▼
┌─────────────────────────────────────────────────────┐
│  Единый MCP-сервер (day-18-server.ts, api.memo7.ru) │
│  ... + 8 тулов day-18, плюс:                        │
│  ├── scan_chat_messages  MTProto: N сообщений чата  │
│  │                       → кеш lastScan             │
│  ├── analyze_messages    детерминированный отчёт    │
│  └── send_to_chat        Bot API → TG_CHAT_ID       │
│                                                      │
│  GramJS userbot (TG_API_ID/HASH/SESSION)            │
└─────────────────────────────────────────────────────┘
```

Данные между тулами: `scan_chat_messages` пишет кеш `lastScan`; `analyze_messages`
читает его (200 сообщений не тащатся через контекст LLM); текст отчёта из
`RESULT` шага 2 модель передаёт как `text` в `send_to_chat`.

---

## Контракты

| Шаг | Тула | Вход | Выход |
|----|------|------|-------|
| 1 получить | `scan_chat_messages` | `chat`, `limit?` (≤1000, по умолч. 200) | `Сканировано N из «…». Топ авторов: …` + кеш |
| 2 обработать | `analyze_messages` | — | отчёт: период, авторы, топ-термины, ссылки |
| 3 отправить | `send_to_chat` | `text` | `Sent to Telegram (message_id=…)` |

`chat` = `@username` / числовой id / заголовок диалога (ищется в `getDialogs`).

---

## Запуск

Сервер уже крутится на api.memo7.ru. Локально для теста:
```bash
pnpm --filter challenge start -- scheduler          # поднять тот же сервер локально
pnpm --filter challenge start -- agent "..." --server http://localhost:3001/mcp
```

Юзерский запуск (прод):
```bash
# CLI
pnpm --filter challenge start -- agent "просканируй последние 200 сообщений в чате 'факты в чате' и пришли отчёт"

# REPL
/agent просканируй последние 200 сообщений в чате "факты в чате" и пришли отчёт
```

---

## Переменные окружения

| Переменная | Назначение |
|---|---|
| `TG_API_ID` | MTProto api_id (my.telegram.org). |
| `TG_API_HASH` | MTProto api_hash. |
| `TG_SESSION` | StringSession (одноразовый логин). |
| `TG_BOT_TOKEN` | Bot API — для `send_to_chat`. |
| `TG_CHAT_ID` | Куда слать отчёт. |
| `HTTPS_PROXY` | Прокси для Bot API (gost → socks5). |

> Примечание: MTProto ходит в Telegram-DC напрямую; если на VPS DC заблокированы,
> для GramJS может понадобиться отдельный прокси (Bot API-прокси тут не помогает).

---

## Файлы дня 19

| Файл | Роль |
|---|---|
| `src/core/agents/telegramScan.ts` | GramJS userbot: connect/disconnect, scan, analyze. |
| `src/core/mcpAgentLoop.ts` | цикл tool-calling + `runAgentRequest` (вход для CLI/REPL). |
| `src/demos/day-18-server.ts` | +3 тула скан-пайплайна на живом сервере. |

Переиспользовано: `core/mcpHttpServer.ts`, `core/mcpHttpClient.ts`,
`core/agents/telegram.ts` (`publishPost`).
