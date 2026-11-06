---
name: security-execution-loop
description: Run a loop-run execution loop with a mandatory security review gate and LLM Gateway on every call. Use for Day 14 / security step / "промпт → генерация → тесты → security review → коммит", for secure code generation, for creating loop-run tracker artifacts (epic/stories/milestone), and when Critical/High findings must send generation back with line-specific feedback. Triggers: execution loop, loop-run, пул задач, security step, LLM Gateway, hardcoded secrets, PII in logs, insecure storage, Android/iOS security review.
---

# Security Execution Loop

## Why this skill exists

Day 14 adds a security gate to the Week-2 execution loop. The same task also
exposed a process miss: the work was framed as a Day-NN feature, so it started as
`business-feature` and no loop-run issues/milestone were created. This skill makes
the tracker step mandatory whenever the task is a security-step execution loop.
It does not replace `agent-profiles`; it specializes the loop for security work.

## When to use

- The request says `execution loop`, `loop-run`, «пул задач», or asks to add a
  security step to a generation loop.
- The task is Day 14 / «День 14. Security step» or a similar secure-code-generation
  challenge.
- Code must be generated, tested, security-reviewed by a second LLM call, and
  committed only after the review gate.
- All LLM traffic must go through the project LLM Gateway.
- A loop-run task needs epic/story issues and a milestone before edits.

Do **not** use for a one-line read-only question, a pure research request, or a
trivial single-file change with no generated-code loop.

## Non-negotiables

1. **Loop mode is explicit and tracked.** Before the first edit, create/confirm:
   - milestone `run-YYYY-MM-DD` (collision: `-2`, `-3`, …);
   - one epic issue;
   - 5–7 story issues, same milestone;
   - labels from the project adapter (`loop-run`, `story`, `epic`, `P0`–`P3`,
     `security`, `test`, `docs`);
   - WIP = 1: only the active story gets `in-progress`.
   Close stories with evidence; close the epic only after all stories.
2. **All LLM calls go through the gateway.** The loop receives an `LlmCaller`;
   in the CLI that is `GatewayClient` → `POST /v1/chat/completions`. No
   `LlmClient`, no provider URL, no provider key in the loop. Gateway must be
   loopback (`127.0.0.1`/`localhost`/`::1`); URL credentials are rejected.
3. **Security review is a second LLM call**, not a local grep. It uses a separate
   stack-specific prompt.
4. **Severity policy is fixed:**
   - `critical`/`high` → regenerate with feedback «исправь: … в строке N»;
   - `medium`/`low` → commit + warning in the log;
   - no findings → commit;
   - invalid/malformed review JSON → `review_error`, fail-closed, no commit.
5. **No leaks into prompts/logs.** Previous code is masked before retry; findings
   already carry only `preview`; logs contain no raw code, secrets, PII, or
   absolute local paths. Run `scanSecrets` over loop and gateway logs.
6. **Commit is a sandbox git commit**, not a commit to the main repo, unless the
   user explicitly asks for a repository commit. Generated code must not enter
   the project history.

## Stage graph

```text
Intake → Track → Baseline → Build (per story) → Validate → Close/Report
                                  |
                                  +→ generation → tests → security review
                                       → commit / regenerate
```

Announce transitions as one line: `stage Intake → Track`.

## 1. Intake

1. Load `agent-profiles` and the project adapter in `AGENTS.md`.
2. Start from `business-feature`, but override the delivery mode to loop-run
   because this skill is explicitly invoked.
3. Print one line:
   `loop-run: milestone=run-YYYY-MM-DD, epic=#, stories=N, WIP=1, gateway=loopback`.
4. Do not ask which profile/branch/milestone to use. Ask only for the adapter's
   ask-exceptions (missing access, destructive action, P0/incident, genuine
   contradiction).

## 2. Track

Create the tracker artifacts **before** touching code. In this project:

```text
gh api repos/{owner}/{repo}/milestones -f title=run-YYYY-MM-DD
```

```text
gh issue create --title "[Day 14] Execution Loop + Security Step" --body-file <epic.md> --label epic --label loop-run --label P1 --milestone run-YYYY-MM-DD
```

```text
gh issue create --title "[Day 14] Core: gateway client + loop contracts" --body-file <story.md> --label story --label loop-run --label P1 --milestone run-YYYY-MM-DD
```

```text
gh issue edit <n> --add-label in-progress
```

Typical stories (adjust to scope, keep disjoint):

| Story | Scope | Priority |
|---|---|---|
| Core | gateway client, loop contracts, logger, sandbox commit, test runners | P1 |
| Security gate | stack prompts, JSON parser, severity policy, feedback | P1 |
| CLI + gateway | `sec-loop`, local/external gateway, loopback, flags | P1 |
| Demo + live-run | 3 provoking tasks, gateway leak-probe, run logs | P1 |
| Docs + CHANGELOG | README, test-cases, live-run, security prompt, logs | P2 |
| Validation | typecheck, full/focused tests, gateway self-test, secret scan | P1 |
| Process retro (if loop was missed) | why tracker was skipped + corrective action | P2 |

Close each story with evidence (files, commands, run ID, commit SHA). Close the
epic last and link the stories. If the loop discipline was missed, create a
`chore P2` retro issue (`cause:loop` if the adapter uses causes), close it with
the corrective action, and mention it in the Report.

## 3. Baseline

Before edits, capture the adapter's baseline:

```text
pnpm --filter challenge typecheck
pnpm --filter challenge test
```

Record the counts. Do not invent a lint command; this project has no lint.

## 4. Build: the security loop

Reference implementation:
`challenge/src/core/securityLoop/` (`gatewayClient`, `prompt`, `review`,
`tests`, `commit`, `logger`, `loop`, `cases`). CLI: `sec-loop`.

Per story:

1. Mark the story `in-progress`.
2. Generate code via `generationPrompt` → `GatewayClient` (stage `generation`).
3. Extract the code (fenced block / JSON `{code}` / bare code).
4. Run the test/lint runner:
   - `StaticTestRunner` — structure, balance, placeholders, contract symbols;
   - `CommandTestRunner` — real `gradlew`/`tsc`/`vitest` command when available.
   If tests fail, regenerate with the failed check as feedback.
5. Run the security review via `securityReviewPrompt` → `GatewayClient`
   (stage `security_review`). The prompt is stack-specific:
   - Android: EncryptedSharedPreferences/Keystore, network security config,
     certificate pinning, HttpLoggingInterceptor, exported components,
     allowBackup, root/tamper detection;
   - iOS: Keychain vs UserDefaults, ATS, pinning, Info.plist, print/NSLog;
   - Web: httpOnly cookie vs localStorage, server-only secrets, SQL, zod,
     CSRF/SSRF/XSS, PII logs;
   - Generic: secrets, PII, HTTPS, validation, authz.
6. Classify with the fixed severity policy. Critical/High → feedback and retry
   (max 3); Medium/Low → commit with warning; clean → commit.
7. Commit through the sandbox committer and close the story with evidence.

### Gateway failure handling

| Failure | Action |
|---|---|
| 422 input block on generation | stop task, log `blocked_gateway_input`, no commit; the leak must be fixed in the input |
| 422 input block on review | retry with `gatewayFindingsToSecurity` (local line numbers), no guard weakening |
| Output Guard `blocked` | retry with a no-secrets instruction; after max attempts no commit |
| Output Guard `redacted` | continue with sanitized code; log `output=redacted`; treat `[SUSPICIOUS_URL]` as a confirmed finding |
| Review JSON invalid/malformed | fail-closed `review_error`, no commit |
| Gateway/network error | task `error`, no commit; do not retry blindly |

### Logging contract

Write to `challenge/.data/security-loop/<runId>/`:

- `events.jsonl` — stage, attempt, decision, requestId, guard, findings summary;
- `report.json` — statuses, attempts, gateway counters/calls, findings, commit SHA.

Gateway audit stays in `challenge/.data/gateway/{audit,intercepted}.jsonl`.
Never log raw code; log hash/lines. No absolute paths. `run_end` carries totals
only.

## 5. Validate

Run the adapter commands plus the focused suite:

```text
pnpm --filter challenge typecheck
pnpm --filter challenge test
pnpm --filter challenge exec node --import tsx --test "src/core/securityLoop/*.test.ts"
pnpm --filter challenge start -- llm-gateway --self-test
```

Then a live smoke:

```text
pnpm --filter challenge start -- sec-loop --max-attempts 3 --rate 120
```

Check:

- 3 real tasks committed with warning or clean; leak-probe blocked by gateway;
- 0 `review_error`/`error` unless the run intentionally tests them;
- `scanSecrets` over `events.jsonl`, `report.json`, `audit.jsonl`,
  `intercepted.jsonl`, sandbox code = 0;
- no absolute paths in the logs;
- gateway audit has `allowed`/`blocked_input`/`outputFindings` with masked
  previews only.

If web is untouched, web typecheck/tests are `n/a` with a reason, not a pass.

## 6. Close / Report

- Close each story with a comment: files, commands/results, live run ID, commit
  SHA, residual risks.
- Close the epic after all stories; link the evidence.
- Write the Report per `agent-profiles/references/report.md`:
  profile, stage graph, files/contracts, acceptance criteria → status, baseline
  and focused checks with output, security checklist, risks, open questions.
- Record loop metrics if the adapter enables them; missing instrumentation is
  `n/a`, not zero.
- If tracker artifacts were created after implementation, say so explicitly in
  the Report and the retro issue; do not present it as a clean loop run.

## Reference: Day 14

- Code: `challenge/src/core/securityLoop/`, CLI `sec-loop`.
- Security prompt: `docs/advanced-day-14/security-prompt.md`.
- Report/runbook: `docs/advanced-day-14/{README,test-cases,live-run}.md`.
- Logs: `docs/advanced-day-14/logs/`.
- Live run: `run-20261106-153805-a4a7`, 15 LLM calls, 3 sandbox commits,
  1 gateway block, 10 warnings.
- Tracker: milestone `run-2026-11-06`, epic #218, stories #211–#216,
  process-retro #217 (retroactive; see #217 for the loop-discipline miss).
- CLI:

```text
pnpm --filter challenge start -- sec-loop
pnpm --filter challenge start -- sec-loop --task t1 --no-commit
pnpm --filter challenge start -- sec-loop --gateway http://127.0.0.1:3040
```

## Checklist

- [ ] Milestone, epic, stories created before edits; WIP=1.
- [ ] Stories have `loop-run` + priority + type labels.
- [ ] All LLM calls go through the gateway; gateway is loopback; no provider key.
- [ ] Security review is a separate second call with a stack-specific prompt.
- [ ] Critical/High → regenerate with line-specific feedback.
- [ ] Medium/Low → commit with warning; clean → commit.
- [ ] Invalid review JSON → fail-closed, no commit.
- [ ] Gateway block/redact events are logged with requestId.
- [ ] Logs/prompts have no raw secrets/PII/absolute paths.
- [ ] Typecheck, full tests, focused tests, gateway self-test, live smoke pass.
- [ ] Stories closed with evidence; epic closed last.
- [ ] Report written; process miss recorded honestly.
