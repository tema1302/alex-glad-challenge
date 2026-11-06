# Day 14 — test cases: execution loop + security step

Focused suite: `challenge/src/core/securityLoop/*.test.ts` — **64/64 pass**.
Full challenge suite: **478/478 pass**.

## Unit / integration

| ID | Сценарий | Ожидание | Факт |
|---|---|---|---|
| SEC-01 | Android security prompt | EncryptedSharedPreferences, network_security_config, pinning, HttpLoggingInterceptor, root, allowBackup | pass |
| SEC-02 | iOS security prompt | Keychain, UserDefaults, ATS, pinning, Info.plist | pass |
| SEC-03 | Web security prompt | httpOnly, localStorage, parameterized SQL, NEXT_PUBLIC_, zod | pass |
| SEC-04 | Prompt safety | `scanSecrets(securitySystemPrompt(stack)) === []` для 4 стеков | pass |
| SEC-05 | Review prompt | Код с 1-based номерами строк + системный чеклист | pass |
| GEN-01 | Feedback priority | В generation prompt есть FEEDBACK SECURITY REVIEW и требование приоритета | pass |
| GEN-02 | Previous code masking | fake API key → `[REDACTED_API_KEY]`, сырого значения нет | pass |
| CODE-01 | Extract fenced code | ` ```kotlin ... ``` ` → содержимое без fence | pass |
| CODE-02 | Extract JSON `{code}` | JSON-обёртка → код | pass |
| CODE-03 | Extract bare code | `package/class` → код | pass |
| CODE-04 | No code | «Не могу помочь» → `null` | pass |
| REV-01 | Review JSON parse | severity/category/line/title/evidence/recommendation | pass |
| REV-02 | `issues` alias | `findings` или `issues` принимаются | pass |
| REV-03 | Unknown severity | `info` → `high` (fail-closed) | pass |
| REV-04 | No findings | `{summary}` → `ok:false` | pass |
| REV-05 | Invalid JSON | текст без JSON → `ok:false` | pass |
| REV-06 | Findings not array | `{findings:"none"}` → `ok:false` | pass |
| REV-07 | Evidence sanitization | email/API key → `[REDACTED_*]` | pass |
| REV-08 | Critical/High | `regenerate`, blocking=2 | pass |
| REV-09 | Medium/Low | `commit_with_warning`, warnings=2 | pass |
| REV-10 | Clean | `commit` | pass |
| REV-11 | Feedback format | `[CRITICAL] строка 42: SQL injection` + fix | pass |
| REV-12 | Gateway findings → line | локальный `scanSecrets` даёт строку 2, без сырого ключа | pass |
| REV-13 | Gateway findings dedupe | 2 × api_key → 1 finding | pass |
| REV-14 | Gateway findings fallback | пустой список → synthetic high | pass |
| REV-15 | Malformed finding | finding без title → fail-closed, не теряется молча | pass |
| REV-16 | Too many findings | >50 findings → fail-closed | pass |
| TEST-01 | Static Kotlin pass | balance + contract + no placeholders | pass |
| TEST-02 | Unbalanced delimiter | fail с detail | pass |
| TEST-03 | TODO placeholder | fail | pass |
| TEST-04 | Missing contract | fail с `pattern not found` | pass |
| TEST-05 | Markdown fence in code | fail | pass |
| TEST-06 | Strings/comments | `}{`, `// }`, `'{'` не ломают balance | pass |
| TEST-07 | Command runner pass | `node {file}` c `console.log` | pass |
| TEST-08 | Command runner fail | stderr с fake key → `[REDACTED_API_KEY]` | pass |
| GW-01 | Gateway allow | content + requestId/guard/cost, без Authorization | pass |
| GW-02 | Model override | `model` в теле | pass |
| GW-03 | 422 input block | `GatewayBlockedError` direction=input, findings | pass |
| GW-04 | content_filter | direction=output | pass |
| GW-05 | masked/redacted | info.input=masked, info.output=redacted | pass |
| GW-06 | Network error | `GatewayHttpError(0)`, без URL/секрета в message | pass |
| GW-07 | 502/empty content | `GatewayHttpError(502)` | pass |
| GW-08 | Loopback check | 127.0.0.1/localhost/::1 ok; remote/credentials/ftp/invalid → RangeError | pass |
| LOOP-01 | Critical → retry → Medium → commit | status `committed_with_warning`, 2 attempts, 4 calls, warning | pass |
| LOOP-02 | Clean → commit | status `committed`, 1 attempt, 2 calls | pass |
| LOOP-03 | Gateway input block на generation | status `blocked_gateway_input`, 0 commit, critical finding | pass |
| LOOP-04 | Gateway output block | status `blocked_gateway_output`, synthetic high | pass |
| LOOP-05 | Tests fail → retry | review не вызывается на первой попытке; feedback с contract | pass |
| LOOP-06 | Gateway input block на review | retry с локальной строкой, previous code masked | pass |
| LOOP-07 | Invalid review JSON | `review_error`, 0 commit | pass |
| LOOP-08 | Max attempts | `rejected_security`, 3 attempts, 6 calls, 0 commit | pass |
| LOOP-09 | Empty code | retry с «В ответе не найден код» | pass |
| LOOP-10 | `commit=false` | dry-run, 0 commit | pass |
| LOOP-11 | Event sequence | run_start → generation/tests/review/decision/commit → run_end | pass |
| LOOP-12 | No absolute paths | в событиях нет windows-drive и POSIX-home путей | pass |
| INT-01 | All calls through gateway | 4 upstream calls, 4 audit records, all allowed, commit | pass |
| INT-02 | Block before upstream | 0 upstream calls, audit `blocked_input`, 0 commit, raw key not in audit | pass |
| INT-03 | Mask mode | 2 calls masked, email finding, upstream called, commit | pass |

## Live gateway cases (2026-11-06, `run-20261106-153805-a4a7`)

| ID | Вход | Ожидание | Факт |
|---|---|---|---|
| LIVE-01 | T2 leak-probe: fake JWT + email в контексте | Input Guard `block`, 422, upstream не вызван | 4 findings: jwt/bearer/email/base64; 1 blocked; 0 upstream |
| LIVE-02 | T3 attempt 1: `http://10.0.2.2:3000` | Output Guard redact HTTP URL | 3 × suspicious_url; generation `output=redacted` |
| LIVE-03 | T3 attempt 2: снова HTTP | Output Guard redact | 2 × suspicious_url; generation `output=redacted` |
| LIVE-04 | T3 attempt 3: HTTPS по умолчанию | Input/Output allow | clean; commit |
| LIVE-05 | T1/T2 clean prompts | Input/Output allow | 8 clean calls; commit |
| LIVE-06 | Audit/intercepted scan | Нет сырых секретов/PII | `scanSecrets` = 0 |
| LIVE-07 | Logs absolute paths | Нет абсолютных путей | 0 совпадений |

## Команды

Focused:

```text
pnpm --filter challenge exec node --import tsx --test "src/core/securityLoop/*.test.ts"
```

Full:

```text
pnpm --filter challenge test
```

Typecheck:

```text
pnpm --filter challenge typecheck
```

Gateway regression:

```text
pnpm --filter challenge start -- llm-gateway --self-test
```
