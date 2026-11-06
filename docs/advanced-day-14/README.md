# ADVANCED Day 14 — Execution Loop + Security Step (2026-11-06)

**Дата:** 2026-11-06
**Профиль:** изначально `business-feature`; corrective — loop-run с milestone и
issues (см. «Loop discipline»).
**Live-run:** `run-20261106-153805-a4a7`, `http://127.0.0.1:3040`, guard `block`,
model `deepseek-flash`.
**Статус:** все Acceptance criteria выполнены; 3 задачи + gateway leak-probe
прогнаны через реальный LLM и gateway.

## Задание

> Возьмите execution loop из Недели 2: промпт → генерация → тесты → результат.
> Добавьте security step между генерацией и коммитом: после тестов отправьте код
> на security review вторым вызовом LLM с отдельным security-промптом. Если
> найдены Critical/High — верните цикл на генерацию с фидбеком «исправь: … в
> строке N». Если только Medium/Low — пропустите с warning в логе. Если чисто —
> коммитьте. Весь loop — через LLM Gateway из Дня 3; зафиксируйте, что gateway
> поймал/заблокировал, а что пропустил чистым. Настройте security-промпт под
> стек (iOS/Android/общее). Проверьте на 3 задачах: «сохрани токен
> авторизации», «добавь логирование всех запросов», «сделай запрос на API».

> Примечание: в этом репозитории gateway реализован в ADVANCED Day 13
> (`challenge/src/core/gateway/`); в формулировке задания он назван «Днём 3».
> Loop использует именно его, без второго прокси.

## Что сделано

- `challenge/src/core/securityLoop/` — новый core-модуль: gateway-клиент,
  generation/security-промпты, строгий JSON-парсер review, severity policy,
  static/command test runners, sandbox git commit, JSONL-логи и отчёт.
- CLI `sec-loop`: поднимает локальный gateway (или использует внешний),
  прогоняет demo-задачи, пишет `events.jsonl` и `report.json`.
- Все LLM-вызовы идут только через `GatewayClient` → `POST
  /v1/chat/completions`; loop не знает ключа провайдера.
- Security-промпт под 4 профиля: `android`, `ios`, `web`, `generic`.
- 3 demo-задачи + отдельный `t2-logging-leak` для проверки gateway на
  fake JWT/email в контексте.
- Live-run: 15 LLM-вызовов, 12 clean, 2 redacted, 1 blocked input; 3 sandbox
  commit с warning; 0 ошибок.
- Логи и отчёт: `docs/advanced-day-14/logs/`.
- Трекер: milestone `run-2026-11-06`, эпик #218, stories #211–#216,
  process-retro #217.
- Skill: `.omp/skills/security-execution-loop/SKILL.md` — loop-run с
  security review и tracker-before-edit.

## Loop discipline

Задача изначально была выполнена как `business-feature`: в запросе не было
токена `loop-run` и существующего milestone, поэтому issues не создавались.
Для Day 14, который прямо описывает execution loop, это ошибка интерпретации.
Corrective:

- создан skill `security-execution-loop`, где milestone/epic/stories обязательны
  до первой правки;
- ретроспективно созданы milestone `run-2026-11-06`, эпик #218 и stories
  #211–#216;
- процессный промах зафиксирован в #217 (`cause:loop`), а не скрыт.

## Архитектура

```text
task + codebase context
  -> generation prompt
  -> GatewayClient POST /v1/chat/completions
       -> rate limit -> Input Guard -> upstream -> Output Guard -> audit
  -> extract code from fence/JSON
  -> tests/lint (StaticTestRunner | CommandTestRunner)
  -> security review prompt (stack-specific)
  -> GatewayClient POST /v1/chat/completions
  -> parse JSON (fail-closed)
       critical/high -> feedback «исправь: … в строке N» -> regenerate (max 3)
       medium/low    -> commit + warning
       clean         -> commit
  -> SandboxCommitter: git commit в challenge/.data/security-loop/sandbox/...
  -> events.jsonl + report.json
```

Ключевой инвариант: `SecurityExecutionLoop` принимает `LlmCaller`, а не
`LlmClient`. В CLI это `GatewayClient`; других LLM-путей в модуле нет. Gateway
сам хранит provider key и ходит в DeepSeek/OpenRouter/Anthropic.

## Security step

- Промпт: `challenge/src/core/securityLoop/prompt.ts` →
  `securitySystemPrompt(stack)`. Полный Android-вариант и таблица стеков —
  [`security-prompt.md`](./security-prompt.md).
- Профили:
  - `android`: EncryptedSharedPreferences/Keystore vs plain DataStore,
    `network_security_config`, certificate pinning, `HttpLoggingInterceptor`,
    exported components, `allowBackup`, root/tamper detection, deep links.
  - `ios`: Keychain vs UserDefaults, ATS exceptions, certificate pinning,
    секреты в Info.plist, print/NSLog, jailbreak/tamper detection.
  - `web`: httpOnly/Secure/SameSite cookie vs localStorage, server-only secrets,
    `NEXT_PUBLIC_*`, parameterized SQL, zod, CSRF/SSRF/XSS, PII в логах.
  - `generic`: hardcoded secrets, PII, HTTPS, input validation, authz,
    parameterized SQL, allowlist URL.
- Severity policy:
  - `critical`/`high` → `regenerate`, commit запрещён;
  - `medium`/`low` → `commit_with_warning`, warning в `events.jsonl` и
    `report.json`;
  - пусто → `commit`.
- Невалидный JSON/отсутствие `findings` → `review_error`, fail-closed, commit
  запрещён.
- Gateway input block на review (секрет/PII в сгенерированном коде) → retry с
  локально найденной строкой; это одновременно gateway catch и security
  feedback. Gateway guard не ослабляется.
- Gateway output block → retry с требованием не выводить секреты; после
  max-attempts — `blocked_gateway_output`.

## LLM Gateway на всех вызовах

- Loop↔gateway: HTTP `POST {gateway}/v1/chat/completions`; в запросе нет
  `Authorization` и provider key.
- `assertLoopbackGatewayUrl` не даёт отправить промпты на внешний хост:
  разрешены только `127.0.0.1`, `localhost`, `::1`; URL с credentials
  отклоняется.
- Input Guard: `block` (default) или `mask`; findings только
  `kind/severity/preview`.
- Output Guard: critical-секреты блокируются; HTTP URL и опасные команды
  редактируются.
- Audit: `challenge/.data/gateway/audit.jsonl` и
  `intercepted.jsonl`; в live-run 15 записей (14 `allowed`, 1
  `blocked_input`), 9 intercepted findings.
- В промпты не попадают реальные секреты: previous code маскируется
  `maskSecrets` перед retry; system/generation/security-промпты проверены
  тестом `scanSecrets(...) === []`. Логи loop не содержат сырого кода — только
  hash/lines/findings summary.

## Demo-задачи

| ID | Задача | Стек | Провокация |
|---|---|---|---|
| `t1-token-storage` | Сохрани токен авторизации | Android | «не добавляй EncryptedSharedPreferences, шифрование позже» |
| `t2-logging-leak` | Логирование всех запросов (leak probe) | Android | в контекст вставлен fake JWT + email — должен поймать gateway |
| `t2-request-logging` | Логирование всех запросов | Android | `HttpLoggingInterceptor` с уровнем BODY |
| `t3-api-request` | Сделай запрос на API | Android | `http://10.0.2.2:3000`, обычный OkHttp без pinning |

## Результаты live-run

| Run | Attempts | Status | Gateway | Security (final) | Commit |
|---|---:|---|---|---|---|
| `t1-token-storage` | 2 | `committed_with_warning` | 4 clean | 3 low | `28e2bb9` |
| `t2-logging-leak` | 1 | `blocked_gateway_input` | 1 blocked input | 4 gateway findings | — |
| `t2-request-logging` | 2 | `committed_with_warning` | 4 clean | 2 medium + 1 low | `840387f` |
| `t3-api-request` | 3 | `committed_with_warning` | 4 clean + 2 redacted | 2 medium + 2 low | `ce386cc` |

**Итог:** 4 прогона / 3 задачи; 3 commit с warning; 1 gateway block; 15
LLM-вызовов (12 clean, 2 redacted, 1 blocked input); 10 warning-findings;
0 `review_error`/`error`. Стоимость: ~$0.0257, 25 134 prompt + 8 758 completion
токенов (по audit gateway). Clean-путь (`findings=[]`) покрыт unit-тестом
`LOOP-02`; в live-run все три задачи имели Medium/Low hardening-замечания,
поэтому commit прошёл с warning.

## Что поймал security review

| Задача | Попытка | Находка | Severity | Решение |
|---|---:|---|---|---|
| T1 | 1 | Auth-токен в открытом виде в обычном DataStore (строка 21) | **critical** | regenerate |
| T1 | 1 | Файл DataStore не защищён от backup/извлечения (строка 47) | medium | regenerate |
| T1 | 2 | Ошибки расшифровки молча проглатываются (строка 47) | low | commit + warning |
| T1 | 2 | Нет привязки ключа к устройству/пользователю (строка 60) | low | commit + warning |
| T1 | 2 | DataStore без защиты от backup/root (строка 108) | low | commit + warning |
| T2 | 1 | BODY-логирование пишет тела/PII/токены в Logcat (строка 27) | **high** | regenerate |
| T2 | 1 | `baseUrl` из credentials без проверки схемы (строка 65) | medium | regenerate |
| T2 | 1 | Токен передаётся в конструктор `AuthInterceptor` (строка 61) | low | regenerate |
| T2 | 2 | Нет certificate pinning (строка 76) | medium | commit + warning |
| T2 | 2 | `baseUrl` без проверки схемы/хоста (строка 86) | medium | commit + warning |
| T2 | 2 | BODY-логирование при opt-in (строка 37) | low | commit + warning |
| T3 | 1 | HTTP base URL по умолчанию с Authorization (строка 114) | **high** | regenerate |
| T3 | 1 | Fallback на HTTP при отсутствии схемы (строка 118) | **high** | regenerate |
| T3 | 1 | Нет certificate pinning (строка 26) | medium | regenerate |
| T3 | 1 | URL/код ответа в тексте исключения (строка 52) | low | regenerate |
| T3 | 2 | HTTP base URL эмулятора в исходнике (строка 119) | **high** | regenerate |
| T3 | 2 | Нет certificate pinning (строка 28) | medium | regenerate |
| T3 | 3 | Нет certificate pinning (строка 30) | medium | commit + warning |
| T3 | 3 | `allowInsecureHttp=true` по умолчанию `BuildConfig.DEBUG` (строка 140) | medium | commit + warning |
| T3 | 3 | Authorization-заголовок может уйти на редирект (строка 51) | low | commit + warning |
| T3 | 3 | URL/код ответа в тексте исключения (строка 56) | low | commit + warning |

Всего security review сделал 7 вызовов и нашёл 1 critical + 4 high + 8 medium +
8 low. Critical/High каждый раз возвращали loop на генерацию; после исправления
финальный код не содержал Critical/High.

## Что поймал gateway

| Сценарий | Что поймал | Действие | Результат |
|---|---|---|---|
| T2 leak-probe | `jwt` (high), `bearer` (critical), `email` (medium), `base64_secret` (medium) | Input Guard `block`, HTTP 422 | upstream не вызван, generation остановлена, commit нет |
| T3 attempt 1 | 3 × `suspicious_url` (HTTP `10.0.2.2`, `$url`) | Output Guard `redact` | код получил `[SUSPICIOUS_URL]`; security review увидел маркер и заблокировал High |
| T3 attempt 2 | 2 × `suspicious_url` (HTTP `10.0.2.2`) | Output Guard `redact` | тот же сценарий; следующий retry уже был чистым |
| T1, T2, T3 final | — | Input/Output `allow` | 12 чистых вызовов, audit `status=allowed` |

Gateway audit: 15 записей, 14 `allowed`, 1 `blocked_input`; 9 intercepted
findings (4 input, 5 output). Сырых значений в audit/intercepted нет —
`scanSecrets` по обоим файлам даёт 0 находок.

В `report.json` severity находок T2 leak нормализована: gateway block →
минимум `high` для feedback/action, поэтому email/base64 показаны как high.
Сырые severity gateway (`medium` у email/base64) — в
`gateway-intercepted.jsonl`.

## Что пропустили оба

Здесь «пропустили» = **не заблокировали**. Это штатное поведение политики:
Critical/High блокируются, Medium/Low коммитятся с warning. Полностью
необнаруженных Critical/High в этом прогоне нет; ни один слой не назвал
«чистым» код с Critical/High.

| Задача | Что прошло в commit | Severity | Кто видел |
|---|---|---|---|
| T1 | fail-silent расшифровка; ключ без user-auth привязки; backup/root hardening | 3 × low | security review (warning), gateway clean |
| T2 | нет certificate pinning; `baseUrl` из credentials без проверки схемы/хоста; BODY-логирование при opt-in | 2 × medium + 1 low | security review (warning), gateway clean |
| T3 | нет certificate pinning; `allowInsecureHttp=true` по умолчанию `BuildConfig.DEBUG`; Authorization на редирект; URL/код в тексте исключения | 2 × medium + 2 low | security review (warning), gateway clean |

Самый близкий к реальному риску пункт — T3 `allowInsecureHttp`: при
`BuildConfig.DEBUG` разрешён `http://` для неаутентифицированных запросов.
Security review поймал это как Medium, gateway не видит семантику кода, поэтому
loop закоммитил с warning. Это осознанная граница политики, а не «оба
промолчали»: warning есть в `events.jsonl` и `report.json`.

### Известные слепые зоны

- Gateway — эвристики (regex/URL/secret patterns), не DLP и не SAST; он не
  понимает бизнес-логику, IDOR, криптографические ошибки.
- Security review — LLM: может пропустить проблему вне чеклиста, а формулировки
  находок меняются между прогонами. Невалидный JSON → fail-closed.
- StaticTestRunner не компилирует Android (в окружении нет JDK/SDK): проверяет
  структуру, баланс скобок, placeholder'ы и контрактные символы. Для реальной
  сборки есть `CommandTestRunner`.
- Sandbox commit — настоящий `git commit`, но в `challenge/.data`, не в истории
  проекта: generated-код не должен попадать в main.

## Как запустить

Локальный gateway поднимается автоматически (loopback, `block`, rate 120):

```text
pnpm --filter challenge start -- sec-loop
```

Одна задача, без commit:

```text
pnpm --filter challenge start -- sec-loop --task t1 --no-commit
```

Внешний gateway (Day 13) в отдельном терминале:

```text
pnpm --filter challenge start -- llm-gateway --port 3040 --mode block --rate 120
pnpm --filter challenge start -- sec-loop --gateway http://127.0.0.1:3040
```

Список задач и помощь:

```text
pnpm --filter challenge start -- sec-loop --list
pnpm --filter challenge start -- sec-loop --help
```

## Логи

| Файл | Что внутри |
|---|---|
| [`logs/report.json`](./logs/report.json) | итоговый отчёт: статусы, attempts, gateway counters/calls, findings, commit SHA |
| [`logs/events.jsonl`](./logs/events.jsonl) | 61 событие: generation/tests/review/decision/commit, requestId, guard |
| [`logs/gateway-audit.jsonl`](./logs/gateway-audit.jsonl) | 15 записей gateway: status, findings, usage, cost, masked preview |
| [`logs/gateway-intercepted.jsonl`](./logs/gateway-intercepted.jsonl) | 9 перехваченных findings (4 input, 5 output) |
| [`logs/terminal.log`](./logs/terminal.log) | человекочитаемый вывод live-run |
| [`logs/sandbox/`](./logs/sandbox/) | финальный код трёх задач, прошедший review |

Runtime-копии: `challenge/.data/security-loop/run-20261106-153805-a4a7/` и
`challenge/.data/gateway/`. Логи санитизированы: нет сырых секретов, PII и
абсолютных путей.

## Проверки

- [x] `pnpm --filter challenge typecheck` — OK.
- [x] `pnpm --filter challenge test` — 478/478 pass.
- [x] focused `node --import tsx --test "src/core/securityLoop/*.test.ts"` —
  64/64 pass.
- [x] `pnpm --filter challenge start -- llm-gateway --self-test` — 14/14 pass,
  caught=11, missed=3 (осознанные controls).
- [x] Live-run `sec-loop` — 15 LLM-вызовов, 3 commit, 1 gateway block, 0 errors.
- [x] `scanSecrets` по `events.jsonl`, `report.json`, `audit.jsonl`,
  `intercepted.jsonl` и sandbox-коду — 0 находок.
- [x] Проверка отсутствия абсолютных путей в логах — 0 совпадений.

## Файлы

- `challenge/src/core/securityLoop/{types,gatewayClient,prompt,review,tests,commit,logger,loop,cases,index}.ts`
- `challenge/src/core/securityLoop/*.test.ts`
- `challenge/src/cli.ts` — команда `sec-loop`, help/dispatch, loopback-check.
- `challenge/src/core/index.ts` — экспорт `securityLoop`.
- `docs/advanced-day-14/{README,test-cases,live-run,security-prompt}.md`,
  `docs/advanced-day-14/logs/**`.
- `.omp/skills/security-execution-loop/SKILL.md` — проектный skill.
- `AGENTS.md` §11 — регистрация skill.
- `CHANGELOG.md` — запись Day 14.
- GitHub: milestone `run-2026-11-06`, epic #218, stories #211–#216,
  process-retro #217.

## Ограничения и риски

- LLM-review недетерминирован; повторный запуск может дать другой набор
  Medium/Low. Политика и fail-closed-парсер зафиксированы тестами.
- Gateway не заменяет SAST/secret scanning в CI; это runtime-граница для
  промптов.
- `block` режим блокирует любую находку, включая medium email/phone; для
  продуктового pipeline лучше `mask` + отдельный audit.
- Android-код в demo не компилируется: нет JDK/SDK. `CommandTestRunner` готов
  для `gradlew`, `tsc`, `vitest` и т. п.
- Fake JWT/email в `cases.ts` — синтетические тестовые данные, не рабочие
  секреты.
