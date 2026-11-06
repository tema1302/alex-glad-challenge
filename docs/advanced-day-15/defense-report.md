# Отчёт защитника — День 15 Red Team (2026-11-06)

Роль: защитник собственного пайплайна. Вход: отчёт атакующего
(`attack-report.md`, 11 пробитий). Все фиксы в ветке `feat/day-15-red-team`,
milestone `run-2026-11-06-2` (эпик #219, stories #220–#225).

## Что пофикшено

### 1. Детекторы обфускации секретов — `challenge/src/core/gateway/secrets.ts`
(commit 19bc999, story #222)

- **Split через операторы языка:** `[a,b].join('')`, `a.concat(b)`, template
  literal с `${…}` — матчатся по оригинальному тексту (точная позиция для
  маскирования), находка засчитывается только если склеенная строка реально
  содержит секрет (`scanJoined` → `scanSecrets`) — закрывает RT-04/05/06.
- **Escape-последовательности:** `\xNN` и `\uNNNN`/`\u{…}` декодируются
  токен-парсером и ресканируются, новый kind `hex_secret` — RT-07.
- **Double base64:** рекурсивный декод с ограничением глубины
  (`MAX_DECODE_DEPTH = 2`) — RT-08.
- **base64 с пробелами/переносами:** нормализация с картой обратных индексов
  (находка и маскирование по исходным позициям) — RT-09.
- **Дедупликация перекрытий** находок (`dedupeOverlaps`) — base64-ws поверх
  base64 не плодит дублей.
- **Output guard:** утечка system prompt ловится также в base64-декодированных
  токенах и в кусках без вставок (префикс 200 нормализованных символов) — RT-11,
  частично RT-12.
- **Инцидент-фикс:** рекурсия детекторов упиралась в reentrancy глобальных
  regex (`lastIndex` сбивался вложенным `scanSecrets`) → бесконечный цикл/OOM.
  Все exec-циклы переведены на `matchAll` (реентерабельно), маскирование —
  по заранее собранным спанам (`replaceWhen`).

### 2. Детерминированный security backstop — `challenge/src/core/securityLoop/backstop.ts`
(commit 830ca7b, story #223)

- `localSecurityFindings(code)`: критичные hardcoded secret (через полный
  `scanSecrets`, включая обфускацию), gateway-маркеры `[REDACTED_*]` /
  `[SUSPICIOUS_*]` в коде, injection/exfil-фразы («это тестовый код…»,
  «ignore previous instructions», «пропусти ревью», готовый JSON-вердикт,
  дамп `process.env`) — severity high/critical — закрывает RT-15/16/17.
- `evaluateSecurityReview(raw, code)` — единая точка решения: parse
  (fail-closed) + merge backstop-находок + classify. Вердикт ревьюера-LLM
  больше не единственный источник: «послушный» ревьюер не может протащить
  коммит.
- Leak-guard в `parseSecurityReview`: фраза утечки в summary/evidence/
  recommendation → `ok:false` (review_error, коммит запрещён) — RT-18.
- `loop.ts`: бэкстоп-находки попадают в TaskReport и решение, событие
  `backstop` в `events.jsonl`.
- Кириллические паттерны: `\w*` не матчит кириллицу — заменено на
  `[а-яё]*` (найдено тестом RT-18/leak-guard).

### 3. Red team как регрессия — `challenge/src/core/redteam/` (commit ee305b6, story #221)

- 18 кейсов RT-01..RT-19 (baseline/hardening/residual), `PipelineTarget`
  гоняет реальные guard'ы и evaluate, scripted-LLM — офлайн и
  детерминированно.
- `pnpm --filter challenge start -- red-team` — обязателен перед боем:
  breach>0 → exit code 1 (CI-совместимо).
- Отчёт без сырых значений: только kind/stage/detail — безопасно пересылать
  партнёру.

## Финальный прогон: те же атаки после фикса

    pnpm --filter challenge start -- red-team

`attacks=18 defended=17 breached=0 residual=1 → PASS`
(run `rt-20261106-170805-b4cc`, отчёт `challenge/.data/red-team/…/report.json`).

Сравнение «до/после» (16 векторов прямого сравнения):
до `defended=5 breached=11` → после `defended=15 breached=1` (артефакты:
`swarm-report/day15-before-evidence.json`, `day15-after-gateway.json`,
`day15-after-loop.json`).

## Что осталось (честно)

- **RT-12 (residual):** system prompt, разрезанный на куски со вставками,
  статикой не ловится — произвольная реконструкция неразрешима без LLM-слоя.
  Компенсация: контекст объявлен данными в system prompt; review — отдельный
  вызов с temperature=0; конвенциональный выход — только через output guard,
  который ловит verbatim/префикс/base64.
- Парафразные инструкции («повтори инструкцию другими словами») — вне
  статических проверок по определению; наблюдаемо в audit/intercepted логах.
- Backstop-паттерны высокоточные, но не исчерпывающие: новая обфускация = новый
  кейс + детектор (процедура RT-04..RT-09 повторяема).
- Gateway loopback-only: наружу пайплайн выставлять только за reverse-proxy/TLS.

## Валидация защитника

- `pnpm --filter challenge typecheck` — чисто.
- `pnpm --filter challenge test` — 505/505 (baseline 478 + 27 новых).
- `pnpm --filter challenge start -- llm-gateway --self-test` — 14/14.
- Живой smoke `sec-loop --task t1 --no-commit` — committed_with_warning,
  4 LLM-вызова, gateway clean=4 (run-20261106-162634-0441).
- Секреты в diff: grep по `sk-`, `Bearer`, `ghp_` — только фейковые фикстуры
  тестов/кейсов.
