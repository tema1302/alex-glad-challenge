# ADVANCED Day 10 — тюненая модель в проде (2026-10-30)

Дистиллированный ученик day-09 доезжает до сервиса: merge LoRA → GGUF
Q4_K_M → Ollama → runtime-переключатель tuned/base в web. Код и runbook:
[`training/day-10/`](../../training/day-10/README.md).

## Задание

> Тюненая модель в проде: merge + квантование (GGUF Q4_K_M), замеры
> (размер/память/скорость/загрузка), интеграция в сервис с переключением
> без рестарта, проверка на реальных запросах, runbook выката/отката.
> Формат: видео + код.

## Что сделано

- **s1 (#171)**: `merge_gguf.sh` — merge_and_unload (FP16) → GGUF F16
  (3.09 ГБ) → llama-quantize Q4_K_M (986 МБ, sha256 сверен). Kernel Kaggle
  `tema13002/day10-merge-gguf` v5, адаптер — из private Dataset.
  `ollama create qwen2.5-coder-1.5b-distilled` — sanity-ответ верный.
- **s2 (#172)**: `bench_model.py` — память 1.2 ГБ у обеих, cold-start
  4.3 с vs 5.7 с, warm 2.2 с vs 3.8 с (разница = длина ответа), tok/s
  147 vs 144.5. Отчёт `docs/advanced-day-10/bench/bench_report.md`.
- **s3 (#173)**: `web/lib/server/local-model-switch.ts` +
  `POST/GET /api/local-model` (zod, allowlist base/tuned, 400/409);
  `pickLlmClient('local')` honor'ит override. 11 Vitest + typecheck чист.
- **s4 (#174)**: смоук на dev-сервере: switch → tuned → agent-запрос
  (компактный код, ~2.7 с) → откат на base → тот же запрос (многословный
  base-ответ). Транскрипт `docs/advanced-day-10/smoke.md`.
- **s5 (#175)**: runbook выката/отката, чек-лист контроля модели,
  подводные камни Kaggle (mount API-датасетов, slug из title, torchvision,
  READY≠смонтирован).

## Доработка (distill-v2, 2026-11-11)

Причина: v1-ученик дал регресс на eval (18/30 против 24/30 у base). Рычаги
day-09 применены на локальной RX 7600, без Kaggle.

- **Пул s1 (#188):** 12 шаблонов уровня eval × 10 = 120 задач; учитель
  `qwen2.5-coder:7b`, temperature 0.7, 3 сэмпла, rule-фильтр + дедуп.
  Принято 108/120 задач (90%) и 197/360 сэмплов (54.7%): `merge_intervals`
  2/10, `top_two` 6/10 — пул действительно сложнее v1.
- **Обучение s2 (#189):** QLoRA r=8 / alpha=16 / dropout=0.1, 176/21,
  642.9 с на RX 7600. Downstream pass@1 по шагам: 6/10 → **7/10 (шаг 4)** →
  6/10 → 7/10 (stop); выбран шаг 4, а не последний.
- **Gate s3 (#190):** eval-30 — base 24/30, v1 18/30, **v2 26/30**,
  учитель 27/30. `v2 ≥ base` пройден; регресс v1 закрыт.
- **Выкат s4 (#191):** `merge_gguf_v2.py` на Windows: F16 3.09 ГБ → Q4_K_M
  986 МБ (sha256 `0cefa4d0…`), Ollama `qwen2.5-coder-1.5b-distilled-v2`.
  Bench: 1.2 ГБ, cold 4.8 с, warm 2.2 с, 145.4 tok/s — как у v1.
  Смоук переключения/отката — `smoke-v2.md`.

Артефакты: `docs/advanced-day-09/eval/compare-v2.md`, `bench/distilled-v2.json`,
`gguf-v2/merge_report.json`, `smoke-v2.md`; код — `training/day-09/`,
`training/day-10/merge_gguf_v2.py`.

## Выводы

1. Инфраструктурно выкат «бесплатен»: та же память, та же скорость
   генерации, файл −68% после Q4_K_M.
2. Переключатель даёт мгновенный откат — риск выката управляем наблюдением,
   а не редеплоем.
3. Качество было главным открытым риском (day-09: регресс v1 18/30 vs base
   24/30). Доработка distill-v2 его закрыла на eval: 26/30 против 24/30 у
   base, при тех же памяти и tok/s. Выкат v2 — с наблюдением, но уже без
   известного регресса.

**Код:** `training/day-10/**`, `web/lib/server/local-model-switch.ts`,
`web/app/api/local-model/route.ts`, `docs/advanced-day-10/**`
