# Facts eval — None (day-08 s1)

Сгенерировано: 2026-10-30T19:19:05.937545+00:00, seed=42
Кейсов: 72 (orig + para по 36 фактам).

| Режим | exact | relaxed | latency avg | p95 |
|---|---|---|---|---|
| tuned | 45/72 (62%) | 45/72 (62%) | 1038 мс | 1396 мс |
| base-none | 0/72 (0%) | 0/72 (0%) | 499 мс | 719 мс |

- `none` — вопрос без контекста; факты выдуманные, в модели их нет.
- `prompt` — все факты в system (подстановка в промпт, аналог RAG).
- exact — нормализованное точное совпадение ответа; relaxed — gold входит в ответ.

Покейсово: `results_transformers__kaggle_working_day07_artifacts_adapter.jsonl`; метрики: `facts.json`.
