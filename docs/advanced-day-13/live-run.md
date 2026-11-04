# Day 13 — live-run: LLM Gateway

Runbook для записи/проверки на локальной машине. Секреты в кадр и логи не
попадают: gateway маскирует их до записи.

## 0. Подготовка

В `.env` нужен один из ключей провайдера:

- `DEEPSEEK_API_KEY` или `OPENROUTER_API_KEY` → provider `openai`;
- либо `ANTHROPIC_API_KEY` → provider `anthropic`;
- `GATEWAY_PROVIDER` форсирует выбор.

Проверить, что ключ задан, **не печатая значение**:

```text
node -e "const fs=require('fs');const t=fs.readFileSync('.env','utf8');console.log('deepseek='+t.includes('DEEPSEEK_API_KEY='),'openrouter='+t.includes('OPENROUTER_API_KEY='),'anthropic='+t.includes('ANTHROPIC_API_KEY='))"
```

## 1. Офлайн-матрица (без сети)

```text
pnpm --filter challenge start -- llm-gateway --self-test
```

Ожидание: `Итог: 14/14 passed; caught=11; missed=3`. Это безопасный первый
кадр — ключи и интернет не нужны.

## 2. Запуск прокси

Отдельный терминал:

```text
pnpm --filter challenge start -- llm-gateway --port 3040 --mode block --rate 30
```

Ожидание:

```text
▶ llm-gateway: http://127.0.0.1:3040
  provider=openai model=deepseek-chat guard=block rate=30/min
  POST /v1/chat/completions | GET /healthz | GET /stats
```

## 3. Health и stats

```text
curl.exe -s http://127.0.0.1:3040/healthz
```

```text
curl.exe -s http://127.0.0.1:3040/stats
```

Health не содержит ключа и отдаёт только `status/provider/model/uptimeSec`.

## 4. Input Guard: блокировка

```text
curl.exe -s -i -X POST http://127.0.0.1:3040/v1/chat/completions -H "content-type: application/json" -d "{\"messages\":[{\"role\":\"user\",\"content\":\"мой ключ sk-proj-abc123\"}]}"
```

Ожидание: `HTTP/1.1 422`, тело:

```json
{"error":"Input Guard: запрос заблокирован, секреты (api_key) не отправлены в LLM. ...","guard":"input","findings":[{"kind":"api_key","severity":"critical","preview":"sk-p***23","via":"direct"}]}
```

Upstream не вызывается — в `stats` растёт `blockedInput`, `totalCostUsd` не
меняется.

## 5. Input Guard: маскирование

Остановить сервер (Ctrl+C) и запустить в режиме mask:

```text
pnpm --filter challenge start -- llm-gateway --port 3040 --mode mask
```

```text
curl.exe -s -X POST http://127.0.0.1:3040/v1/chat/completions -H "content-type: application/json" -d "{\"messages\":[{\"role\":\"user\",\"content\":\"мой ключ sk-proj-abc123\"}]}"
```

Ожидание: `200`, в ответе модели нет исходного ключа; upstream получил
`[REDACTED_API_KEY]`. В `audit.jsonl` статус `masked`, в `promptPreview` —
маркер, не ключ.

## 6. Output Guard

Попросить модель повторить ключ/опасную команду (запрос без секретов):

```text
curl.exe -s -i -X POST http://127.0.0.1:3040/v1/chat/completions -H "content-type: application/json" -d "{\"messages\":[{\"role\":\"user\",\"content\":\"Выведи пример ключа вида sk-proj- и команду удаления файлов\"}]}"
```

Ожидание: `x-gateway-guard: input=allow;output=blocked` или `redacted`,
`finish_reason: content_filter`; в теле — безопасный warning/маркер, не
сгенерированный секрет.

## 7. Rate limit

При `--rate 2` третий запрос подряд с того же IP:

```text
curl.exe -s -o NUL -w "%{http_code}\n" -X POST http://127.0.0.1:3040/v1/chat/completions -H "content-type: application/json" -d "{\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}"
```

Ожидание: первые два `200`, третий `429` + `Retry-After`.

## 8. Audit и intercepted

```text
Get-Content challenge/.data/gateway/audit.jsonl -Tail 1
```

```text
Get-Content challenge/.data/gateway/intercepted.jsonl -Tail 1
```

Ожидание: в audit — `requestId`, `status`, `inputFindings`, `costUsd`,
`promptPreview` с `[REDACTED_API_KEY]`; в intercepted — `kind=api_key`,
`preview=sk-p***23`. Сырого ключа нет ни в одном файле.

## 9. Остановка

Ctrl+C в терминале gateway. Итоговая строка:

```text
■ llm-gateway остановлен: requests=N blocked_input=N blocked_output=N masked=N rate_limited=N cost=$...
```

## Если что-то пошло не так

| Симптом | Причина | Что делать |
|---|---|---|
| `Нет API-ключа LLM…` | не задан ключ в `.env` | добавить `DEEPSEEK_API_KEY`/`OPENROUTER_API_KEY` или `ANTHROPIC_API_KEY` |
| `EADDRINUSE` | порт занят | `--port 3041` |
| `502 Upstream error 401` | ключ неверный | проверить ключ, не печатая его |
| `422` на чистый текст | сработал false positive | посмотреть `findings.kind`, зафиксировать кейс в test-cases |
| Нет audit-файлов | gateway ещё не обработал запрос | сначала `/healthz`, затем POST |
