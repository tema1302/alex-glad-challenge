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

## Выводы

1. Инфраструктурно выкат «бесплатен»: та же память, та же скорость
   генерации, файл −68% после Q4_K_M.
2. Переключатель даёт мгновенный откат — риск выката управляем наблюдением,
   а не редеплоем.
3. Качество — главный открытый риск (day-09: регресс на eval); выкат под
   наблюдением, дальше — доработка дистилляции.

**Код:** `training/day-10/**`, `web/lib/server/local-model-switch.ts`,
`web/app/api/local-model/route.ts`, `docs/advanced-day-10/**`
