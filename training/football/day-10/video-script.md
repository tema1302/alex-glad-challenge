# Видео-скрипт: Day 10 (футбольный трек) — тюненая модель в проде

Хронометраж ~7–9 минут.

## 1. План (0:00–0:30)
Слияние → квантование/экспорт → замеры → сервис → переключение → откат.

## 2. Merge и экспорт (0:30–2:00)
- merge_export.py: adapter + base → fp16 safetensors (~1 ГБ) →
  `ollama create qwen2.5-0.5b-football`. Modelfile: FROM + temperature 0;
  чат-шаблон подхватывается из tokenizer_config.
- merge_report.json: sha256, размер. Контроль артефакта.

## 3. Замеры (2:00–3:30)
- bench_model.py: размер на диске, память (ollama ps), cold/warm wall,
  tok/s — tuned vs base (qwen2.5:0.5b-instruct).

## 4. Сервис (3:30–6:00)
- Переключатель из day-10 (local-model-switch.ts) — не трогаем, только
  env: LOCAL_LLM_MODEL=base, LOCAL_LLM_TUNED_MODEL=qwen2.5-0.5b-football.
- Старт web, GET /api/local-model, POST переключение, реальный запрос
  /api/agent llm:"local" — до и после.
- Смоук в docs/advanced-day-10/football/smoke.md.

## 5. Выкат/откат (6:00–7:30)
- Runbook: где лежит модель, как проверяется перед выкаткой, откат
  мгновенный (POST base) и полный (env + рестарт).

## 6. Итог всего трека 6–10 (7:30–8:00)
- Одна минута: датасет → тюн → границы → дистилляция → прод.
