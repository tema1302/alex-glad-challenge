# Day 9 — дистилляция: ученик Qwen2.5-Coder-1.5B на ответах учителя coder:7b

День проверки гипотезы: «маленькая модель + SFT на ответах большой
заменяет большую на узком домене». Домен: генерация Python-функций по
спецификации (проверяемо — тесты исполняются). Все замеры реальные:
Ollama локально (localhost:11434), обучение — Kaggle T4 (kernel
`tema13002/day09-distill-student-t4` v1, один прогон train+eval).

## Пайплайн

```text
gen_tasks.py → eval_code.py            (s1: eval-набор 30 задач, base vs teacher)
gen_train_tasks.py → gen_teacher.py    (s2: пул 120 train-задач, ответы учителя)
split_distill.py → train_student.py    (s3: QLoRA-обучение ученика на Kaggle T4)
eval_code.py --backend transformers    (s3/s4: eval ученика на eval-наборе)
compare.py                             (s4: ученик до/после/учитель)
```

## s1 — eval-набор и замер разрыва (#169)

30 задач: 20 базовых + 10 посложнее (анаграммы, snake_case, баланс скобок,
missing_number, two_sum, инверсии, digit_root и др.). Gold по построению;
скорер извлекает `def` из ответа и исполняет тесты в песочнице с
безопасными builtins.

| Модель | pass@1 | latency avg |
|---|---|---|
| ученик до: `qwen2.5-coder:1.5b-base` | **24/30 (80%)** | 2396 мс |
| учитель: `qwen2.5-coder:7b` | **27/30 (90%)** | 3077 мс |

## s2 — ответы учителя и фильтрация (#170)

120 train-задач (12 шаблонов × 10 слотов, seed=42; пересечений с eval — 0,
assert в gen_train_tasks.py). Учитель генерировал локально (7b, Ollama,
temperature=0, seed=42); фильтр: извлечённая функция должна пройти все
тесты задачи. **Принято 120/120** (accept 100%, avg 2735 мс, wall 328 с) —
пул для учителя лёгкий (честно зафиксировано: ученику нечему учиться в
части «сложности»). Датасет: `data/distill_train.jsonl` (messages-формат).

## s2 v2 — hard-mined пул и семплирование учителя (distill-v2 s1, #188)

Причина: v1-пул дал accept 120/120 и train loss 0.0 — ученик зазубрил шаблоны.
v2: 12 шаблонов уровня eval (композиция циклов/условий) × 10 = 120 задач,
seed=42, пересечений с eval-30 нет (assert по именам и spec в
`gen_train_tasks_v2.py`). Учитель `qwen2.5-coder:7b` локально: temperature=0.7,
3 сэмпла на задачу, rule-фильтр (все тесты зелёные), дедуп по коду.

Результат (`data/distill_v2_stats.json`):

- accepted tasks **108/120 (90%)**, accepted samples **197/360 (54.7%)**;
- rejected: duplicate 118, wrong 39, runtime 6;
- latency avg 3409 мс, wall 1227 с;
- сложные шаблоны: `merge_intervals` 2/10, `top_two` 6/10, остальные 10/10.

Датасет: `data/distill_train_v2.jsonl` (messages-формат, поле `sample`),
rejected — `data/distill_rejected_v2.jsonl`.
Запуск: `python training\day-09\gen_train_tasks_v2.py`; `python training\day-09\gen_teacher.py --tasks training/day-09/data/train_tasks_v2.jsonl --temperature 0.7 --samples 3 --out training/day-09/data/distill_train_v2.jsonl --rejected training/day-09/data/distill_rejected_v2.jsonl --stats training/day-09/data/distill_v2_stats.json`

## s3 v2 — обучение ученика на RX 7600 (distill-v2 s2, #189)

`train_student.py` + `configs/qlora_v2_rx7600.yaml`: QLoRA NF4 r=8 / alpha=16 /
dropout=0.1, данные v2 (176 train / 21 valid), 3 эпохи, eval каждые 2 шага.
`DownstreamCallback` считает pass@1 на 10 holdout-задачах eval-30 после каждого
eval-шага, останавливает обучение при отсутствии улучшения и сохраняет лучший
по pass@1 адаптер.

Прогон на RX 7600 (`.venv-rocm`, torch 2.14.0+rocm10.1.0): 642.9 с, 8 шагов,
train loss 0.0518, eval loss 0.0399. Кривая downstream pass@1:

| Шаг | pass@1 |
|---|---|
| 2 | 6/10 |
| 4 | **7/10** (best) |
| 6 | 6/10 |
| 8 | 7/10 (без улучшения → stop) |

Лучший чекпоинт — шаг 4; он скопирован в `artifacts-v2/adapter` (gitignored).
Пост-хок `downstream_eval.py` на `checkpoint-4` воспроизводит 7/10. `run.json`
фиксирует GPU `AMD Radeon RX 7600`, версии стека и sha датасетов.
Запуск: `training\.venv-rocm\Scripts\python.exe training\day-09\train_student.py --config configs/qlora_v2_rx7600.yaml`

## s3 — обучение ученика (#176)

`train_student.py` (стек day-07: QLoRA NF4 r=16, fp16, маска assistant,
early stopping), base `Qwen/Qwen2.5-Coder-1.5B`, 3 эпохи, сплит 107/13.
Kaggle T4: обучение **56.5 с**, best checkpoint-15, **final train loss
0.0**, eval loss 4.3e-05 — ученик зазубрил пул целиком. Артефакты в
`training/day-09/artifacts/` (gitignored).

## s4 v2 — eval v2 на eval-30 и quality gate (distill-v2 s3, #190)

`eval_code.py --backend transformers --config configs/qlora_v2_rx7600.yaml
--adapter artifacts-v2/adapter` на eval-30 (seed=42):

| Вариант | pass@1 |
|---|---|
| base (Ollama) | 24/30 |
| v1 (T4, r=16) | 18/30 |
| **v2 (RX 7600, r=8)** | **26/30** |
| учитель coder:7b | 27/30 |

Gate `v2 ≥ base` пройден (26 ≥ 24). Подробная таблица и провалы —
`docs/advanced-day-09/eval/compare-v2.md`, сырьё — `docs/advanced-day-09/eval/student-v2/`.

## s4 — сравнение трёх вариантов (#177)

| Вариант | pass@1 | latency avg | вес | VRAM (оценка) |
|---|---|---|---|---|
| ученик до (Ollama) | 24/30 | 2396 мс | 1.5B | ~1.2 ГБ |
| ученик после (T4) | **18/30** | ~3.5 с | 1.5B + LoRA | ~1.2 ГБ |
| учитель (Ollama) | **27/30** | 3077 мс | 7B | ~4.7 ГБ |

**Вывод: ученик пока НЕ заменяет учителя.** На невиданных задачах ученик
после дистилляции хуже даже собственного base (18 против 24; рантаймы
разные — Ollama vs transformers/T4 — но падение на 6 задач при том же
наборе и промпте указывает на регресс). Экономика при этом реальна: 4×
меньше памяти, ~1.3× быстрее в Ollama.

Где ученик ошибается после тюна — реальные outputs (регрессии: base и учитель
решают, ученик нет; 6 из 30: t02, t04, t12, t14, t23, t28):

| Задача | ученик до (base) | ученик после (distilled) | учитель |
|---|---|---|---|
| t04 `word_count("hello world")` → 2 | `return len(text.split())` ✅ | `return text.count(' ')` → даёт 1 ❌ | ✅ |
| t02 `is_prime` | `all(n % i != 0 ...)` ✅ | лишняя скобка → SyntaxError ❌ | ✅ |
| t28 `digit_root(38)` → 2 | цикл `while n > 9` ✅ | один проход `sum(...)` → 11 ❌ | ✅ |

Ошибки не форматные (функция извлекается и исполняется), а логические: ученик
«упростил» алгоритмы до уровня шаблонов пула. Это и есть зазубривание —
train loss 0.0 на 107 лёгких примерах не перенёсся на unseen-задачи. Где
заменял бы уже сейчас: повторяющиеся шаблонные задачи уровня пула — но это
и так закрывает base.

## Рычаги (follow-up, если день продолжим)

1. **Hard-mining пула**: train-задачи уровня eval (учитель тоже должен
   напрягаться; accept < 100% — признак полезной сложности).
2. **Следящий eval на holdout-задачах** из eval-дистрибуции — ранняя
   остановка по pass@1, а не по eval loss (loss 4e-05 ничего не говорит).
3. Меньше ёмкости LoRA (r=8, dropout 0.1) против зазубривания.
4. Temperature-семплирование учителя (t=0.7, 2–4 сэмпла на задачу) для
   разнообразия датасета.

## Методология и риски

- pass@1 при temperature=0 — детерминированный прогон; сидирование Ollama
  и transformers разное, полная детерминизация между рантаймами не гарант.
- 30 задач — маленький набор: разница 24 vs 18 значима, 27 vs 24 — уже
  нет (пограничная).
- Тесты исполняют код модели локально; неймспейс с безопасными builtins,
  задачи чисто вычислительные, сеть/файлы недоступны.
