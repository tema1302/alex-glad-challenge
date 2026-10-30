# day-07 — baseline без тюна (реальный прогон)

- Модель: `qwen2.5:1.5b-instruct` (Ollama локально), temperature=0, seed=42
- Дата: 2026-10-30T16:25:17.942042+00:00

| Режим | parse_ok | format_ok | full_match | text | recurring | dow | interval | latency, мс |
|---|---|---|---|---|---|---|---|---|
| none | 0/30 | 0/30 | 0/30 | 0/30 | 0/30 | 0/30 | 0/30 | 3029.3 |
| prompt | 30/30 | 30/30 | 14/30 | 19/30 | 19/30 | 21/30 | 28/30 | 2274.0 |

## По классам gold (full_match)

| Режим | класс | full_match |
|---|---|---|
| none | None | 0/11 |
| none | daily | 0/6 |
| none | hourly | 0/5 |
| none | weekly | 0/8 |
| prompt | None | 1/11 |
| prompt | daily | 2/6 |
| prompt | hourly | 4/5 |
| prompt | weekly | 7/8 |

Метрики: parse_ok — JSON извлечён; format_ok — ответ ровно один JSON без прозы; full_match — все 4 поля совпали с gold. Покейсово: `baseline_results.jsonl`; параметры: `baseline.json`.
