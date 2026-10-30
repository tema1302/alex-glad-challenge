# Out-of-domain eval — transformers+/kaggle/working/day07/artifacts/adapter (day-08 s2)

Сгенерировано: 2026-10-30T18:48:33.112231+00:00, seed=42
Кейсов: 24 (chat/math/translate/code по 6). Метрика: exact, для translate — токенный F1.

| Режим | score avg | chat | code | math | translate | latency, мс |
|---|---|---|---|---|---|
| tuned | 0.42 | 0.17 | 0.17 | 0.67 | 0.69 | 716 |
| base-none | 0.40 | 0.00 | 0.50 | 0.50 | 0.62 | 582 |
| base-prompt | 0.50 | 0.33 | 0.17 | 0.67 | 0.82 | 378 |

- `tuned` — адаптер day-07 включён (только transformers-бэкенд);
- `base-none` / `base-prompt` — адаптер выключен / голый Ollama.
- Цифры: падение tuned относительно base = цена файнтюна вне домена.

Покейсово: `results_<режим>.jsonl`; метрики: `outdomain.json`.
