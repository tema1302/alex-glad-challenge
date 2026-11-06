# Day 14 — live-run logs

Источник: `run-20261106-153805-a4a7`, gateway `http://127.0.0.1:3040`,
guard `block`, model `deepseek-flash`. Скопировано из
`challenge/.data/security-loop/run-20261106-153805-a4a7/` и
`challenge/.data/gateway/`; runtime-копии остаются в `.data` (gitignored).

| Файл | Размер | Что внутри |
|---|---|---|
| `report.json` | 4 задачи | статусы, attempts, gateway counters/calls, findings, commit SHA, warnings |
| `events.jsonl` | 61 событие | generation/tests/review/decision/commit, requestId, guard, решения |
| `gateway-audit.jsonl` | 15 записей | 14 `allowed` + 1 `blocked_input`; usage/cost, masked preview |
| `gateway-intercepted.jsonl` | 9 findings | 4 input (jwt/bearer/email/base64) + 5 output (suspicious_url) |
| `terminal.log` | live output | человекочитаемый отчёт без pnpm-префиксов и абсолютных путей |
| `sandbox/TokenStore.kt` | финальный T1 | EncryptedSharedPreferences/Keystore, прошёл review |
| `sandbox/RequestLoggingInterceptor.kt` | финальный T2 | HEADERS + redaction, release NONE |
| `sandbox/TaskApiClient.kt` | финальный T3 | HTTPS/token provider, cleartext только debug-флаг |

Проверки перед коммитом в docs:

- `scanSecrets` по `report.json`, `events.jsonl`, `gateway-*.jsonl` и
  `sandbox/*.kt` — 0 находок;
- абсолютные пути (windows drive letter, POSIX home) — 0 совпадений;
- fake JWT/email из T2 leak-probe есть только в `intercepted.jsonl` в виде
  preview (`eyJh***5c`, `e***@e***`), сырых значений нет.
