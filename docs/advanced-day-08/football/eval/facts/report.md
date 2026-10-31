# s1: факты в весах (day-08 football)

Модель: Qwen/Qwen2.5-0.5B-Instruct + LoRA r=16 (CPU fp32); факты: 36 вымышленных (Челси/АПЛ), 30 эпох, final train loss 0.000603, стенка 928.7 с. temperature=0, seed=42.

| Режим | exact | n |
|---|---|---|
| trained-none-orig | 36/36 (100%) | 36 |
| trained-none-para | 14/36 (39%) | 36 |
| base-none | 2/72 (3%) | 72 |
| base-prompt | 12/72 (17%) | 72 |

Покейсово: `results.jsonl`; метрики: `facts_trained.json`.
