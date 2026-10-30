# Out-of-domain eval — qwen2.5:7b-instruct (day-08 s2)

Сгенерировано: 2026-10-30T17:39:06.917965+00:00, seed=42
Кейсов: 24 (chat/math/translate/code по 6). Метрика: exact, для translate — токенный F1.

| Режим | score avg | chat | code | math | translate | latency, мс |
|---|---|---|---|---|---|
| base-none | 0.77 | 0.50 | 1.00 | 0.67 | 0.92 | 2197 |
| base-prompt | 0.90 | 0.83 | 1.00 | 0.83 | 0.95 | 2184 |

- `tuned` — адаптер day-07 включён (только transformers-бэкенд);
- `base-none` / `base-prompt` — адаптер выключен / голый Ollama.
- Цифры: падение tuned относительно base = цена файнтюна вне домена.

Покейсово: `results_<режим>.jsonl`; метрики: `outdomain.json`.
