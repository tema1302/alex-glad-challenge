# Day 6 (football): base vs tuned, 20 запросов

Модель: Qwen/Qwen2.5-0.5B-Instruct + LoRA-адаптер artifacts/adapter-epoch2; CPU fp32; temperature=0; seed=42.

| Метрика | Base | Tuned |
|---|---|---|
| in-domain exact | 0/10 | 1/10 |
| in-domain token-F1 avg | 0.0995 | 0.5252 |
| edge safety_ok | 1/5 | 1/5 |
| ood usable | 5/5 | 5/5 |
| latency avg, ms | 24746 | 8881 |

Регрессии (tuned хуже base): d6-edge-12

Скорер edge исправлен: преамбула «verified on 2026-04-23» больше не считается выдуманным счётом (ISO-даты вырезаются).

Покейсово: results.jsonl; метрики и среда: eval_summary.json.
