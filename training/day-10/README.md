# Day 10 — тюненая модель в проде: выкат, переключатель, откат

День про механику: адаптер ученика day-09 становится Ollama-моделью,
сервис умеет переключаться между tuned/base без рестарта, есть runbook
выката/отката. Все замеры — реальные прогоны.

## Артефакты и где что лежит

| Что | Где |
|---|---|
| Скрипт merge+quantize | `training/day-10/merge_gguf.sh` (Kaggle/Linux) |
| GGUF Q4_K_M (986 МБ, sha256 `b91286ee…`) | `training/day-10/artifacts/gguf/` (gitignored; копия собирается runbook'ом) |
| Kaggle kernel мержа | `tema13002/day10-merge-gguf` v5 (CPU, датасет `tema13002/day09-student-adapter`) |
| Ollama-модель | `qwen2.5-coder-1.5b-distilled` (Modelfile: FROM gguf + temperature 0) |
| Переключатель | `web/lib/server/local-model-switch.ts`, endpoint `/api/local-model` |
| Бенчмарки | `docs/advanced-day-10/bench/` |
| Смоук выката/отката | `docs/advanced-day-10/smoke.md` |

## Runbook выката (новая версия tuned)

1. **Собрать адаптер** — обучение по day-09 (`train_student.py`, Kaggle T4).
   Артефакты: `training/day-09/artifacts/adapter/`.
2. **Залить адаптер в Kaggle Dataset** (private):
   blob-upload (`ApiStartBlobUpload` → PUT → `create_dataset`), имя
   `tema13002/dayNN-<name>-adapter`. Дождаться `get_dataset_status = READY`
   (иначе kernel стартует без mount — ловушка v2/v3 дня-10).
3. **Смержить и заквантовать** — kernel по образцу `day10-merge-gguf`:
   attach dataset → `merge_gguf.sh` (merge_and_unload FP16 →
   convert_hf_to_gguf → llama-quantize Q4_K_M → Modelfile + merge_report с
   sha256). Зависимости pip: `torch==2.6.0 torchvision==0.21.0` (парно!),
   `transformers==4.46.3 peft==0.13.2 accelerate==1.1.1`.
4. **Проверить артефакт**: скачать `student-Q4_K_M.gguf`, сверить sha256 с
   `merge_report.json`, записать размер.
5. **Установить в Ollama**: `ollama create qwen2.5-coder-1.5b-distilled -f
   Modelfile`; sanity-запрос (короткий код-ответ).
6. **Задать env сервиса**: `LOCAL_LLM_TUNED_MODEL=qwen2.5-coder-1.5b-distilled`
   (base — в `LOCAL_LLM_MODEL`, как раньше). Рестарт для env — ок, это не
   «переключение», а конфигурация выката.
7. **Переключить**: `POST /api/local-model {"model":"…-distilled"}`.
8. **Проверить**: `GET /api/local-model` (active=tuned) + реальный запрос
   (`POST /api/agent llm:"local"`) — ответ должен быть в характере tuned.

## Откат

- Мгновенный (runtime): `POST /api/local-model {"model":"base"}` — обратно
  без рестарта. Проверено смоуком (docs/advanced-day-10/smoke.md).
- Полный: убрать/переопределить `LOCAL_LLM_TUNED_MODEL` и перезапустить —
  переключатель становится недоступным (switchable:false), сервис живёт на
  base. Ошибочный override при этом не применяется (allowlist).

## Контроль перед выкаткой (definition of done для модели)

- [ ] sha256 GGUF совпал с merge_report.json.
- [ ] Sanity-ответ tuned характерен (код без воды) — сравнить с base.
- [ ] Бенчмарк (`bench_model.py`): память/скорость не хуже base
      (day-10: 1.2 ГБ обе, ~147 ток/с обе).
- [ ] Качество на домене не хуже порога (day-09 честно зафиксировал
      регресс 18/30 vs 24/30 — выкатывать под наблюдением или после
      доработки дистилляции, issue #179-аналог для day-09).
- [ ] Смоук переключения/отката пройден на staging.

## Подводные камни (зафиксированы в этой сессии)

- **Kaggle datasets из API** монтируются в `/kaggle/input/datasets/<owner>/<slug>/`
  (не legacy `/kaggle/input/<slug>/`).
- **Slug kernel'а** сервер берёт из title (lower+dashes); несовпадение с
  заданным slug → 403 `kernels.get` по «старому» имени.
- **torchvision обязателен в паре с torch** — иначе transformers падает на
  `torchvision::nms`.
- **Датасет READY ≠ смонтирован**: kernel, стартовавший до обработки,
  падает с FileNotFoundError — проверять статус и давать паузу.

## Метрики дня

- GGUF: F16 3.09 ГБ → Q4_K_M 986 МБ (−68%).
- Память: 1.2 ГБ (base и tuned одинаково).
- Скорость: tok/s 147.0 (tuned) vs 144.5 (base); warm wall 2.2 с vs 3.8 с
  (разница — длина ответа, не скорость генерации).
- Переключение: <100 мс (in-memory override), без рестарта.
