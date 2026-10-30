# Day 7 — свой датасет: NL -> JSON add_todo (Qwen2.5-1.5B-Instruct + QLoRA)

Узкая повторяющаяся задача с проверяемым результатом: русская фраза →
структурированная задача планировщика (`add_todo` / `TodoDb`). Обучение —
на Kaggle T4 (локально AMD RX 7600 без CUDA, как в дне-06).

## Задача

```json
{"text": "Полить цветы", "recurring": "weekly", "day_of_week": 2, "interval_hours": null}
```

- Поля: `text` (действие без слов о расписании), `recurring`
  (null|daily|weekly|hourly), `day_of_week` (0=вс…6=сб, конвенция JS `getDay`
  — та же, что в `challenge/src/core/todoParser.ts`), `interval_hours`
  (int ≥ 1).
- **Верный ответ** = точное совпадение всех 4 полей.
- Граница схемы: абсолютные даты (`scheduled_at`), интервалы в днях/минутах,
  два дня недели («вторник и четверг») — **пунт**: `recurring=null`, текст
  без изменений. Это честные boundary-кейсы в eval.
- Продуктовая привязка: NL→tool-args перед MCP `add_todo`
  (`challenge/src/demos/day-18-server.ts`); сейчас `todoParser.ts` флаги
  (`--daily|--weekly N|--hourly N`) понимает, а фразы типа «каждый вторник
  полить цветы» — нет.

## Данные (в git: `data/`, `eval/`)

| Набор | Размер | Источник |
|---|---|---|
| train | 463 | сиды руками (412 вызовов шаблонов, gold по построению) + LLM-входы (qwen2.5:7b-instruct локально, 160 принято после rule-валидации) |
| valid | 63 | тот же пул, хэш-сплит |
| eval | 30 | handcrafted, слоты не пересекаются с train-списками (`seeds.py` assert) |

Чистка: точные дубли → почти-дубли (difflib ≥ 0.92, снято 46) → утечки eval
(порог 0.90, снято 0). Баланс классов: weekly 177 / daily 122 / none 116 /
hourly 111. Статистика: `data/stats.json`; отклонённые LLM-кандидаты:
`data/rejected.jsonl` (59 шт., 27% — rule-валидатор ловил «каждый день»+null,
«полчаса»→30 часов, висячие предлоги в text). Ревью глазами 30 случайных —
3 итерации (найденные дыры валидатора закрыты). Утечки и структура:
`check_split.py` — OK.

## Baseline без тюна (реальный прогон 2026-10-30, Ollama локально)

Модель `qwen2.5:1.5b-instruct` (тот же family, что цель тюна), temperature=0,
seed=42, 30 кейсов. Артефакты: [`../../docs/advanced-day-07/eval/`](../../docs/advanced-day-07/eval/)
(`baseline_report.md`, `baseline.json`, `baseline_results.jsonl`).

| Режим | parse_ok | full_match | text | recurring | dow | interval | latency |
|---|---|---|---|---|---|---|---|
| none (без инструкций) | 0/30 | 0/30 | 0/30 | 0/30 | 0/30 | 0/30 | 3029 мс |
| prompt (схема + 3 few-shot) | 30/30 | **14/30** | 19/30 | 19/30 | 21/30 | 28/30 | 2274 мс |

Это планка, которую тюн обязан превзойти. Целевой порог успеха дня:
full_match ≥ 21/30 (70%) при parse_ok 30/30 у tuned.

## Пайплайн

```text
seeds.py → generate_data.py → check_split.py → train_qlora.py → evaluate_tuned.py
(sиды)     (шаблоны+LLM+         (утечки/       (QLoRA T4)      (3 режима, одна
            rule-gold+чистка)     баланс)                         загрузка, вкл/выкл)
```

Локально (без GPU, только Python 3.10+ stdlib + Ollama для LLM-генерации):

```bash
cd training/day-07
python generate_data.py --llm-model qwen2.5:7b-instruct   # ~6 мин
python check_split.py                                      # утечки/баланс
python eval_baseline.py --model qwen2.5:1.5b-instruct      # baseline (Ollama)
```

Обучение — только в облаке (T4):

## Kaggle-runbook (воспроизведение)

1. <https://www.kaggle.com/code> → New Notebook → Add-ons → Accelerator:
   **GPU T4 x2 или P100**, Internet: **On**.
2. Upload папки `training/day-07/` (или `git clone` репозитория).
3. По одной ячейке:

```bash
pip install -r training/day-07/requirements.txt
cd training/day-07
python train_qlora.py          # 463×4 эпохи, eff.batch 16: ~10–20 мин на T4
python evaluate_tuned.py --out ../../docs/advanced-day-07/eval
```

4. Скачать из Output: `artifacts/adapter/`, `artifacts/run.json`,
   `artifacts/loss.csv`; `docs/advanced-day-07/eval/tuned_*.jsonl|md|json` —
   скопировать в репозиторий (в git — только отчёты, не adapter).

Colab-альтернатива: Runtime → T4 GPU, те же команды после
`!git clone <repo>`.

**Run-статус: обучение на T4 НЕ выполнено** (выполняет владелец; код и
runbook готовы). После прогона: обновить `docs/advanced-day-07/README.md`
числами из `tuned_report.md` и `run.json`, отметить пункт ниже.

- [ ] Прогон на T4: train loss / eval loss / wall-clock из `run.json`
- [ ] `tuned_report.md` в `docs/advanced-day-07/eval/`
- [ ] Сравнение с baseline (≥ 21/30 full_match — порог успеха)

## Методология eval

- Одна и та же 4-bit загрузка модели; tuned = адаптер вкл, base = выкл
  (`disable_adapter()`) — разница ровно одна.
- Одинаковые tokenizer/chat-template; `do_sample=False` (temperature=0),
  `max_new_tokens=120`, seed=42.
- Метрики: `parse_ok` (JSON извлечён), `format_ok` (ровно один JSON,
  без прозы/markdown), `full_match` (все 4 поля), per-field accuracy,
  latency. Boundary-пунты оцениваются как обычные кейсы (gold задан).
- Локальный baseline (Ollama) и облачный tuned (transformers generate) —
  разные рантаймы; latency между ними несравнимы, метрики качества — да.

## Риски

- 463 примера — на нижней границе «от 200» с запасом; при слабом tuned
  первый рычаг — ещё LLM-генерация (`--llm-batches 60`).
- Punt-класс (11/30 eval) — самый трудный для тюна: модель может
  «выучить» punt слишком охотно (частота punt в train 22%).
- T4 не умеет bf16 — везде fp16 (как в дне-06).
