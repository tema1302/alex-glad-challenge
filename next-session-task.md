# Задание на следующую сессию (handoff от 29.10.2026)

Состояние после уборки веток: `main == origin/main` (`df5a8e9`), рабочее дерево
чистое. Локальные и remote-ветки вычищены; осталась только `feat/artel-chat` —
она открыта в worktree `C:\Users\user\AppData\Local\Temp\opencode\artel-chat-wt`
(эпик [#134](https://github.com/tema1302/alex-glad-challenge/issues/134) ещё
открыт, #135/#137 закрыты и смержены).

Пункты ниже — по убыванию важности; к каждому — критерий готовности.

## 1. Prod-build web после merge (долг валидации)

Merge `web/arcade-review-fixes` прошёл typecheck + vitest 654/654 и dev-smoke,
но `pnpm --filter web build` не гонялся (production standalone + CSP-nonce).

- [ ] `pnpm --filter web build` — 0 ошибок, standalone-артефакт собирается.
- [ ] Smoke: `pnpm --filter web start:test` (порт 3100); `/` и `/showcase` → 200;
      лендинг показывает «Свежее в канале» либо корректно скрывает секцию без сети
      (username канала не задан в env → `{ ok: false }`, секция не рендерится).
- [ ] Если вскроются prod-CSP/nonce-дефекты — issue + отдельный фикс
      (`fix(web): ...`), без «заодно».

## 2. CHANGELOG: два расхождения с реальностью

- Гап: смерженные фичи (аркада 2.0 — XP/уровни/7 достижений/шеринг через
  `t.me/share`; командная палитра Ctrl+K; «Свежее в канале» на лендинге) не имеют
  записей в `CHANGELOG.md` — добавить по формату существующих entries, с код-путями.
- Устарело: запись «ADVANCED Day 6» заявляет «GPU-прогон не запускался, заглушки»,
  а прогон состоялся (2026-10-26T20:13Z, Tesla T4): format_ok in-domain 10/10,
  exact match 7/10, schema_ok 10/10, regressions (edge+ood) 5/10,
  latency 1319→1704 ms. Источник: `docs/advanced-day-06/eval/{run.json,report.md,loss.csv}`.
- [ ] Поправить запись day-06 и дописать feature-записи.
- [ ] `training/day-06/README.md` — заменить «подготовлено, но не запускалось» на
      фактический результат со ссылкой на `docs/advanced-day-06/`; отдельно
      зафиксировать, куда выложен LoRA-адаптер (если никуда — завести TODO/issue
      на публикацию в приватный HF Hub или GitHub Release).

## 3. Антимайнер-ритуал (регулярность)

`antiminer-task.md` актуален; карантин `quarantine-miner/` удалён 29.10.2026
(SHA256 образцов — в журнале сессии/сводке ниже), папка в `.gitignore`.

- [ ] Завести задачу планировщика (каждые 24 ч):
      `powershell -NoProfile -ExecutionPolicy Bypass -File miner-check.ps1`,
      лог с ротацией во `%TEMP%`, в repo писать только сводки.
- [ ] Разовый полный прогон по 9 разделам `antiminer-task.md` → ожидаемый
      вердикт `ЧИСТО`. `ПОДОЗРЕНИЕ`/`ЗАРАЖЕНИЕ ПОВТОРНО` → P0/incident-issue
      с приоритетом выше обычного.

SHA256 удалённых образцов (для сопоставления с VirusTotal при необходимости):
`6EB4E0BC37D65FDF7644AB620737E14F4C7DFA9666ACDE43D5F38AB1E9094AC1` —
SecurityHealthHost.exe (28 556 288 байт, одна из двух копий),
`11BD2C9F9E2397C9A16E0990E4ED2CF0679498FE0FD418A3DFDAC60B5C160EE5` —
WinRing0x64.sys (14 544 байта),
`1870385D8F713BE14C5FDECF116A89806AA13E31C78562282702785C02456F05` — sp.dat (8 байт).

## 4. Android (epic #134) — продолжение в worktree

- [ ] Сверка поверхностей: web NavCoreLinks ↔ экраны `android/` — таблица
      «есть/нет».
- [ ] Story-issues на следующие parity-срезы: закрыты #114 (геймификация),
      #115 (todos), #116–#124 — проверить, не осталось ли непокрытых
      разделов (разводка: calendar/integrations/assistant/support уже есть).
- [ ] Как только срез в worktree добивается до коммитабельного состояния — PR
      `feat/artel-chat` → main (squash), закрывающий соответствующий story.

## 5. Демо day-33 — справка по структуре

Фича /support в main есть (`challenge/src/core/supportCenter.ts`,
`web/app/support/page.tsx`, CLI `support-seed`), но файла
`challenge/src/demos/day-33.ts` в main нет.

- [ ] Решить: либо минимальное демо в `demos/registry.ts`, либо запись в
      `challenge/README.md`, что день 33 реализован фичей (как day-26..28).
      Вариант по умолчанию — второй (демо-дни 31+ не замораживаются жёстко,
      но и не обязательны).

## 6. Гигиена малвари (не код)

- `quarantine-miner/` удалён и замочен в `.gitignore`; не восстанавливать.
- Появился снова → P0/incident (реинфекция); скрипты `miner-kill.ps1` /
  `miner-verify.ps1` уже в корне.
- `.wb-tmp/` — игнорируется; скриншоты `hram-*.png` и `start-hram-blog.mjs`
  в git не нужны, удалить в любой момент безопасно.
