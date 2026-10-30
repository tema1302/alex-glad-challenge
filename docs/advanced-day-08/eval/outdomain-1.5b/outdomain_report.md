# Out-of-domain eval — qwen2.5:1.5b-instruct (day-08 s2)

Сгенерировано: 2026-10-30T17:37:21.632658+00:00, seed=42
Кейсов: 24 (chat/math/translate/code по 6). Метрика: exact, для translate — токенный F1.

| Режим | score avg | chat | code | math | translate | latency, мс |
|---|---|---|---|---|---|
| base-none | 0.36 | 0.00 | 0.33 | 0.50 | 0.61 | 2195 |
| base-prompt | 0.39 | 0.17 | 0.17 | 0.67 | 0.57 | 2092 |

- `tuned` — адаптер day-07 включён (только transformers-бэкенд);
- `base-none` / `base-prompt` — адаптер выключен / голый Ollama.
- Цифры: падение tuned относительно base = цена файнтюна вне домена.

Покейсово: `results_<режим>.jsonl`; метрики: `outdomain.json`.
