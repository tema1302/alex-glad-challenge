# Day 6 (футбольный трек) — первый тюн на готовом датасете:
# Global Football Knowledge Assistant + Qwen2.5-0.5B-Instruct (LoRA, CPU)

Готовый HF-датасет: `shehrozrafaqat/global-football-assistant-dataset`
(9600 ChatML-примеров, порождённых из 302 фактов; роль — футбольный
ассистент с дисциплиной «date-aware safety»: live-данные не выдумывать, а
отправлять к официальным источникам). Поведение модели меняется заметно:
жёсткий стиль ответов датасета, узкая роль, дисциплина верификации.

## Стек выбора

| Слой | Выбор | Почему |
|---|---|---|
| Датасет | `global-football-assistant-dataset` | готовый, ChatML, узкая роль + safety-поведение, без gating |
| Модель | `Qwen/Qwen2.5-0.5B-Instruct` | 0.5B, Apache-2.0, влезает в 16 ГБ RAM на CPU fp32 |
| Железо | локальный CPU (12 потоков, fp32) | машина без CUDA (AMD RX 7600); фиксируем: CPU fp32, ~41 мин |
| Метод | LoRA r=16 α=32, dropout 0.05 | как day-08 (факты), без bnb: fp32 + peft |
| Данные | train 1300 / val 160 | субсемпл; групповой сплит по fact_id |

Лицензия датасета на карточке не указана — риск зафиксирован (см. ниже).

## Пайплайн

```text
prepare_data.py -> train_lora.py -> plot_loss.py -> evaluate.py
(сплиты+eval-20)   (CPU LoRA)       (loss.svg)      (base vs tuned)
```

- Сплит **групповой по fact_id** (sha256(seed:fact_id)): весь факт в одном
  сплите, утечек нет. eval-20 (10 in-domain / 5 edge date-aware / 5 ood)
  собран из held-out фактов и исключён из train/val. Статистика:
  `data/stats.json`.
- Обучение: loss только на assistant-токенах, батчи с группировкой по
  длине, val-loss каждую эпоху, адаптер каждой эпохи (свип для day-08).
- Eval: одна загрузка модели + адаптер; base = `disable_adapter()`, tuned =
  адаптер вкл; разница ровно одна. temperature=0, seed=42.

## Результаты (реальный прогон 2026-10-31, CPU)

Обучение: 1300 примеров × 2 эпохи, batch 8, lr 1e-4, AdamW;
**стенка 2445.8 с (~41 мин)**; final train loss 0.0167; val loss
0.7019 (эп.1) → 0.6938 (эп.2). Высокий val loss ожидаем: вал-факты модель
не видела — датасет учит стилю/роли/дисциплине, а не знаниям.

| Метрика (20 запросов) | Base | Tuned |
|---|---|---|
| in-domain exact | 0/10 | 1/10 |
| in-domain token-F1 avg | 0.0995 | 0.5252 |
| edge safety_ok | 1/5 | 1/5 |
| ood usable | 5/5 | 5/5 |
| latency avg | 24 746 ms | 8 881 ms |

- **in-domain**: tuned отвечает в доменном стиле (F1 ×5.3), exact низкий,
  т.к. gold — шаблонные фразы датасета, модель перефразирует.
- **edge**: найдена регрессия `d6-edge-12` — на adversarial-формулировке
  («Can I trust old data for current league table?») tuned даёт определение
  вместо осторожного ответа base. Скорер исправлен (ISO-даты «2026-04-23»
  в преамбуле больше не считаются выдуманным счётом).
- **ood**: потерь универсальности нет (5/5 → 5/5, без football-pivot).
- **latency**: base доматывает до 200 токенов, tuned останавливается по EOS.

Артефакты: `artifacts/adapter-epoch1..2`, `run.json` (параметры запуска:
git SHA, версии пакетов, seed, CPU, RAM), `loss.csv`, `loss.svg`.
Отчёты eval: [`docs/advanced-day-06/football/eval/`](../../docs/advanced-day-06/football/eval/)
(`results.jsonl`, `report.md`, `eval_summary.json`).

## Воспроизведение

```bash
cd training/football/day-06
python prepare_data.py      # сырой jsonl уже в data/ (6.6 МБ)
python train_lora.py        # ~40 мин CPU
python plot_loss.py
python evaluate.py --out ../../../docs/advanced-day-06/football/eval
```

## Риски (честные)

- Лицензия датасета не указана — только исследование/демо, не прод без
  проверки прав.
- Все 9600 примеров порождены 302 фактами: тюн копит стиль, а не знания
  (это фича для day-08: границы тюна).
- 0.5B на CPU: latency ~9 с/ответ — годится для демо, не для интерактива.
