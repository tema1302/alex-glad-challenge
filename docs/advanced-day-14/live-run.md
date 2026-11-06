# Day 14 — live-run: execution loop + security step

Runbook и фактические результаты прогона 2026-11-06. Секреты в кадр и логи не
попадают: gateway маскирует их до записи, loop пишет только preview/hash.

## 0. Подготовка

В `.env` нужен один из ключей провайдера: `DEEPSEEK_API_KEY`,
`OPENROUTER_API_KEY` или `ANTHROPIC_API_KEY`. Проверить наличие, **не печатая
значение**:

```text
node -e "const fs=require('fs');const t=fs.readFileSync('.env','utf8');console.log('deepseek='+t.includes('DEEPSEEK_API_KEY='),'openrouter='+t.includes('OPENROUTER_API_KEY='),'anthropic='+t.includes('ANTHROPIC_API_KEY='))"
```

Порт gateway по умолчанию `3040`; проверить, что свободен:

```text
Get-NetTCPConnection -LocalPort 3040 -State Listen -ErrorAction SilentlyContinue
```

## 1. Быстрый запуск (локальный gateway)

`sec-loop` сам поднимает gateway на loopback в режиме `block`, rate 120:

```text
pnpm --filter challenge start -- sec-loop --max-attempts 3 --rate 120
```

Ожидаемый старт:

```text
▶ local gateway: http://127.0.0.1:3040 mode=block
▶ security loop run-...: security loop: 4 task(s)
```

## 2. Внешний gateway (Day 13)

Отдельный терминал:

```text
pnpm --filter challenge start -- llm-gateway --port 3040 --mode block --rate 120
```

Второй терминал:

```text
pnpm --filter challenge start -- sec-loop --gateway http://127.0.0.1:3040
```

`--gateway` принимает только loopback (`127.0.0.1`/`localhost`/`::1`); URL с
credentials отклоняется.

## 3. Отдельные сценарии

Только задача с токеном, без commit:

```text
pnpm --filter challenge start -- sec-loop --task t1 --no-commit
```

Только gateway leak-probe:

```text
pnpm --filter challenge start -- sec-loop --task t2-leak
```

Список задач:

```text
pnpm --filter challenge start -- sec-loop --list
```

## 4. Фактический прогон 2026-11-06

- Run: `run-20261106-153805-a4a7`
- Gateway: `http://127.0.0.1:3040`, `guard=block`, `rate=120`
- Provider/model: `openai` / `deepseek-flash` (blocked input не дошёл до
  upstream, поэтому в его audit-записи model — дефолт gateway)
- Длительность: ~52 с (15 LLM-вызовов)
- Стоимость: ~$0.0257 (25 134 prompt + 8 758 completion токенов)

| Run | Attempts | Status | Gateway | Security final | Commit |
|---|---:|---|---|---|---|
| `t1-token-storage` | 2 | `committed_with_warning` | 4 clean | 3 low | `28e2bb9` |
| `t2-logging-leak` | 1 | `blocked_gateway_input` | 1 blocked input | jwt/bearer/email/base64 | — |
| `t2-request-logging` | 2 | `committed_with_warning` | 4 clean | 2 medium + 1 low | `840387f` |
| `t3-api-request` | 3 | `committed_with_warning` | 4 clean + 2 redacted | 2 medium + 2 low | `ce386cc` |

Итог:

```text
tasks=4 committed=0 committed_with_warning=3 rejected=0 gateway_blocked=1 errors=0
llm_calls=15 clean_calls=12 blocked_input=1 blocked_output=0 warnings=10 blocking_findings=4
```

`blocking_findings=4` в итоговой строке — это финальные findings T2 leak-probe
(1 critical + 3 high после нормализации gateway block). По всем попыткам
security review дополнительно поймал 1 critical + 4 high (T1/T2/T3) и вернул их
на генерацию.

Полный вывод: [`logs/terminal.log`](./logs/terminal.log).

## 5. Как читать логи

| Файл | Что искать |
|---|---|
| `logs/events.jsonl` | `security_review_result.data.findings` — что нашёл review; `decision` — `regenerate`/`commit_with_warning`; `gateway_blocked` — что поймал gateway |
| `logs/report.json` | финальные статусы, `gatewayCalls[].requestId`, `gatewayCalls[].input/output`, findings, commit SHA |
| `logs/gateway-audit.jsonl` | `status` (`allowed`/`blocked_input`), `inputFindings`, `outputFindings`, `usage`, `costUsd` |
| `logs/gateway-intercepted.jsonl` | только перехваченные findings: direction/kind/severity/preview |
| `logs/sandbox/*.kt` | код, который прошёл review и был закоммичен |

Примеры:

```text
Get-Content docs/advanced-day-14/logs/gateway-audit.jsonl -Tail 1
```

```text
Get-Content docs/advanced-day-14/logs/gateway-intercepted.jsonl -Tail 1
```

Ожидание для blocked input: `status=blocked_input`, `inputFindings` с
`jwt/bearer/email/base64`, upstream не вызывался. Для redacted: `status=allowed`,
`outputFindings` с `suspicious_url`, `responsePreview` с `[SUSPICIOUS_URL]` или
безопасным текстом.

## 6. Проверка отсутствия утечек

```text
node -e "const fs=require('fs');const f='challenge/.data/security-loop/run-20261106-153805-a4a7/events.jsonl';const t=fs.readFileSync(f,'utf8');console.log('sk-prefix='+t.includes('sk-'),'jwt-prefix='+t.includes('eyJ'),'email-domain='+t.includes('@example.com'),'abs='+/[A-Za-z]:\\\\/.test(t))"
```

Ожидание: все `false`.

## 7. Воспроизведение

```text
pnpm --filter challenge start -- sec-loop --max-attempts 3 --rate 120
```

Из-за недетерминизма LLM набор Medium/Low и число попыток могут отличаться.
Инварианты стабильны:

- Critical/High → `regenerate`, commit запрещён;
- Medium/Low → `commit_with_warning`;
- gateway input block → `blocked_gateway_input`, upstream не вызван;
- gateway output block → retry/`blocked_gateway_output`;
- invalid JSON → `review_error`, commit запрещён;
- все LLM-вызовы — через gateway; в логах нет сырых секретов/PII и абсолютных
  путей.
