# Sweep чекпоинтов day-07 (переобучение, day-08 s3)

Сгенерировано: 2026-10-30T19:55:48.228338+00:00, seed=42
Valid: 63 кейсов (full_match, system из обучения); out-of-domain: 24 кейсов (avg score).

| Модель | valid full_match | out-of-domain avg |
|---|---|---|
| base | 1/63 | 0.2254 |
| checkpoint-30 | 55/63 | 0.0915 |
| checkpoint-60 | 55/63 | 0.0996 |
| checkpoint-90 | 56/63 | 0.0917 |
| checkpoint-116 | 56/63 | 0.0917 |

## Кривая eval loss (из loss.csv)

- точек: 4, минимум 0.0191 на шаге 90
- расхождение (eval_loss растёт >5% от минимума после него): НЕТ

Покейсово: `results.jsonl`; сводка: `sweep.json`.
