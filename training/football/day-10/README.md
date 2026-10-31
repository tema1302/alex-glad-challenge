# Day 10 (футбольный трек) — тюненая модель в проде: выкат, переключатель, откат

День про механику: адаптер футбольного трека становится Ollama-моделью,
сервис переключается между tuned/base без рестарта, есть runbook
выката/отката. Переключатель — существующий из day-10
(`web/lib/server/local-model-switch.ts`, `/api/local-model`): allowlist =
{LOCAL_LLM_MODEL, LOCAL_LLM_TUNED_MODEL}; футбольный трек только задаёт env
и регистрирует модель в Ollama — чужой код не трогаем.

## Артефакты и где что лежит

| Что | Где |
|---|---|
| Скрипт merge+export | `training/football/day-10/merge_export.py` |
| Слитая fp16-модель | `training/football/day-10/artifacts/merged-fp16/` (gitignored) |
| Modelfile | `training/football/day-10/artifacts/Modelfile` |
| merge-отчёт (sha256, размер) | `training/football/day-10/artifacts/merge_report.json` |
| Ollama-модель | `qwen2.5-0.5b-football` (Modelfile: FROM merged-fp16 + temperature 0) |
| Бенчмарки | `docs/advanced-day-10/football/bench/` |
| Смоук выката/отката | `docs/advanced-day-10/football/smoke.md` |

## Runbook выката (новая версия tuned)

1. **Обучить адаптер** — day-07 или day-09 футбольного трека.
2. **Слить и экспортировать**: `python merge_export.py --adapter <путь>
   --name qwen2.5-0.5b-football` — merge_and_unload → fp16 safetensors →
   `ollama create`. Проверить `ollama_create_rc == 0` в merge_report.json.
3. **Проверить артефакт**: sha256 safetensors в merge_report.json; sanity:
   `ollama run qwen2.5-0.5b-football` с футбольным JSON/заметкой.
4. **Задать env сервиса**:
   `LOCAL_LLM_MODEL=qwen2.5:0.5b-instruct` (base),
   `LOCAL_LLM_TUNED_MODEL=qwen2.5-0.5b-football` (tuned).
   Рестарт для env — часть выката, не «переключение».
5. **Переключить без переката**: `POST /api/local-model {"model":"qwen2.5-0.5b-football"}`.
6. **Проверить**: `GET /api/local-model` (active=tuned, switchable=true) +
   реальный запрос через `/api/agent` (llm:"local") — ответ должен быть
   в характере tuned (JSON парсера или репортаж — по тому, что выкатили).
7. **Бенчмарк** `bench_model.py` против base — память/скорость не хуже.

## Откат

- Мгновенный (runtime): `POST /api/local-model {"model":"base"}` — обратно
  без рестарта.
- Полный: убрать/переопределить `LOCAL_LLM_TUNED_MODEL`, рестарт —
  переключатель становится недоступным (switchable:false), сервис живёт
  на base. Ошибочный override не применяется (allowlist).

## Контроль перед выкаткой (definition of done для модели)

- [ ] sha256 safetensors совпал с merge_report.json.
- [ ] Sanity-ответ tuned характерен (сравнить с base).
- [ ] Бенчмарк: память/скорость не хуже base.
- [ ] Качество на домене не ниже порога (цифры day-07/day-09).
- [ ] Смоук переключения/отката пройден.

## Метрики дня (реальный прогон 2026-10-31)

- Слияние: adapter-epoch3 + Qwen2.5-0.5B-Instruct → fp16 safetensors
  (942 МБ) → GGUF f16 (988 МБ) → **Q4_K_M 379 МБ** (llama.cpp b12023,
  llama-quantize 3.7 с). sha256 в `artifacts/merge_report.json`.
- Ollama: `qwen2.5-0.5b-football` (GGUF + ChatML TEMPLATE + temperature 0
  + stop `<|im_end|>`). Прямой импорт safetensors этим Ollama-билдом не
  поддержан (unsupported MLX architecture) — зафиксировано в merge_report.
- Бенч (bench_model.py, docs/advanced-day-10/football/bench/):

| Метрика | tuned (Q4_K_M) | base (qwen2.5:0.5b-instruct) |
|---|---|---|
| Диск | 379 МБ | 379 МБ |
| Память (ollama ps) | 483 МБ | 483 МБ |
| Cold wall | 4 484 мс | 3 938 мс |
| Warm wall avg (5) | 2 553 мс | 2 991 мс |
| tok/s avg | 143.0 | 176.6 |

Warm wall у tuned ниже за счёт короткого ответа (~70 токенов против
лимита 220 у base); чистая скорость генерации tuned ниже (143 vs 177
ток/с) — плата за более «тяжёлый» стиль вывода; память и размер равны.
- Переключение: <100 мс (in-memory override), без рестарта; allowlist env
  режет неизвестные имена (смоук, smoke.md).
- Ключевая находка прогона: tuned выражает строгий JSON-контракт ТОЛЬКО с
  полным system prompt day-07; с коротким/чужим системным промптом
  поведение деградирует к доменной прозе (факты остаются верными).
  Runbook требования: выкат всегда с контрактным промптом.

## Подводные камни (зафиксированы в этой сессии)

- **Ollama 0.40.13 не импортирует safetensors-диреторию** («unsupported MLX
  architecture: Qwen2ForCausalLM») — путь выката: GGUF. convert_hf_to_gguf
  из репозитория llama.cpp (pip-версии gguf/conversion отставали/опережали:
  нужны gguf-py и conversion/ по тому же тегу) + llama-quantize из релиза
  b12023. Все скрипты/инструкции — в `tools/llama.cpp/` (не в git) и
  `merge_export.py`.
- **GGUF из convert_hf_to_gguf вшивает tokenizer.chat_template** —
  безопаснее явный TEMPLATE в Modelfile; сверять `ollama show --modelfile`.
- **Переключатель валидирует имя по allowlist из env** — опечатка в имени
  модели даст 409/400, а не тихий сбой (проверено смоуком).
- **Tuned-модель — контрактная**: строгий JSON только с полным system
  prompt day-07; sanity-тест с коротким промптом выглядит как base —
  час ушёл на диагностику «не той» модели, которая оказалась просто
  неактивированной контрактом. Урок зафиксирован в runbook.
