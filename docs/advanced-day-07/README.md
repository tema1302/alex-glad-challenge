# ADVANCED Day 7 — свой датасет: NL → JSON add_todo

Узкий SFT под собственную задачу с проверяемым результатом: русская фраза →
структурированная задача планировщика. Код:
[`training/day-07/`](../../training/day-07/README.md).

## Задание

> Свой датасет: узкая повторяющаяся задача с проверяемым результатом;
> замеры без тюна (базовая модель без инструкций и с проработанным промптом);
> датасет 200+ примеров; чистка (дубли, ручной просмотр 30, разброс, формат);
> обучение и сравнение промптинга с тюном на eval-наборе. Формат: видео + код.

## Выбор и почему

| Слой | Выбор | Почему |
|---|---|---|
| Задача | NL → JSON `add_todo` (text, recurring, day_of_week, interval_hours) | узкая, повторяющаяся, результат = точное сравнение полей; продуктовая привязка: NL→tool-args перед MCP `add_todo` (сейчас `todoParser.ts` понимает только флаги) |
| Модель | `Qwen/Qwen2.5-1.5B-Instruct` | тот же стек дня-06; 1.54B, Apache-2.0, 4-bit в T4 |
| Железо | Kaggle T4 (обучение), Ollama локально (baseline/генерация) | локально AMD RX 7600 без CUDA |
| Данные | сиды руками + шаблоны + LLM-входы (qwen2.5:7b-instruct) | реальных логов `.data/todos.sqlite` нет; «чего не хватает — генерируй входы моделью» |
| Формат ответа | компактный JSON в одну строку | «модель учится в том числе форматированию» — формат единый везде |

## Что считается верным ответом

Точное совпадение всех 4 полей: `text` (действие без слов о расписании),
`recurring` (null/daily/weekly/hourly), `day_of_week` (0=вс…6=сб, конвенция
`getDay` из `todoParser.ts`), `interval_hours` (int ≥ 1). Boundary-кейсы
(два дня недели, интервал в днях/минутах, абсолютные даты) — пунт:
`recurring=null`, текст без изменений.

## Датасет (в git)

| Набор | Размер | Классы (weekly/daily/none/hourly) |
|---|---|---|
| train | 463 | 177 / 122 / 116 / 111 |
| valid | 63 | — |
| eval | 30 (handcrafted) | 8 / 6 / 11 / 5 |

- Источники: 412 сид-вызовов (шаблоны × слоты, gold по построению,
  `seeds.py`) + LLM-входы qwen2.5:7b-instruct (220 кандидатов → 160 принято,
  27% отбраковано rule-валидатором — статистика в `data/stats.json`,
  полный список брака в `data/rejected.jsonl`).
- Чистка: точные дубли → почти-дубли (difflib ≥ 0.92: −46) → утечки eval
  (−0). Ревью глазами 30 случайных × 3 итерации: найдены и закрыты 3 дыры
  валидатора («каждый день»+null, «полчаса»→interval_hours:30, висячий
  предлог «про …» в text).
- `check_split.py`: пересечений train/valid/eval — 0 (точные и почти-дубли),
  структура messages валидна, train ≥ 200, valid ≥ 30.

## Замеры без тюна (реальный прогон 2026-10-30T16:25Z)

Модель `qwen2.5:1.5b-instruct` (Ollama локально), temperature=0, seed=42.
Артефакты: [`eval/`](eval/) (`baseline_report.md`, `baseline.json`,
`baseline_results.jsonl`).

| Режим | parse_ok | format_ok | full_match | text | recurring | dow | interval | latency |
|---|---|---|---|---|---|---|---|---|
| none (без инструкций) | 0/30 | 0/30 | 0/30 | 0/30 | 0/30 | 0/30 | 0/30 | 3029 мс |
| prompt (схема + 3 few-shot) | 30/30 | 30/30 | **14/30** | 19/30 | 19/30 | 21/30 | 28/30 | 2274 мс |

По классам (full_match, prompt): weekly 7/8, hourly 4/5, daily 2/6,
пунт-none 1/11. Вывод уже виден: жёсткий формат (parse_ok 30/30) промпт
вытягивает, а точная семантика полей (recurring/day/text-чистка) — нет:
это и должна закрыть SFT.

## Замеры tuned (реальный прогон T4, 2026-10-30T18:26Z)

Модель `Qwen/Qwen2.5-1.5B-Instruct` 4-bit + LoRA-адаптер (вкл/выкл на одной
загрузке), temperature=0, seed=42, transformers generate (рантайм отличается
от Ollama-бейзлайна — сравнивать tuned с base-prompt в этой же таблице).
Артефакты: [`eval/`](eval/) (`tuned_report.md`, `tuned.json`,
`tuned_results.jsonl`); обучение: `train loss 0.0056`, `best eval loss
0.0191` (checkpoint-90), wall-clock 452.9 с.

| Режим | parse_ok | format_ok | full_match | text | recurring | dow | interval | latency |
|---|---|---|---|---|---|---|---|---|
| tuned | 30/30 | 30/30 | **14/30** | 16/30 | 26/30 | 26/30 | 29/30 | 3374 мс |
| base-prompt | 27/30 | 30/30 | 10/30 | 12/30 | 17/30 | 24/30 | 25/30 | 1984 мс |
| base-none | 0/30 | 0/30 | 0/30 | 0/30 | 0/30 | 0/30 | 0/30 | 7004 мс |

По классам (tuned): hourly 5/5, weekly 3/8, daily 2/6, punt-None 4/11.
Порог успеха ≥ 21/30 **не достигнут**: тюн обошёл same-runtime промпт
(14 vs 10) и научил модель формату без few-shot (base-none 0/30), но
семантика weekly/punt осталась слабой. Рычаги и разбор — в
[`training/day-07/README.md`](../../training/day-07/README.md); follow-up
issue по доработке датасета/обучения.

## Пайплайн и статусы

- [x] Eval-набор 30 кейсов + сиды (`eval/eval_set.jsonl`, `seeds.py`)
- [x] Генерация датасета 463/63 + чистка + check_split (`data/`)
- [x] Baseline без тюна — реальные прогоны (`eval/baseline_*`)
- [x] Код обучения (`train_qlora.py`, QLoRA NF4 r=16 α=32, маска
      assistant-токенов, early stopping)
- [x] `evaluate_tuned.py` (3 режима на одной загрузке) + Kaggle-runbook
- [x] **Обучение на T4 выполнено** (kernel `tema13002/day07-qlora-todo-t4`
      v8; adapter/чекпоинты/run.json/loss.csv в `training/day-07/artifacts/`,
      в git не входят)
- [x] Сравнение tuned vs baseline (порог full_match ≥ 21/30 не достигнут:
      tuned 14/30 vs same-runtime base-prompt 10/30 — см. разбор)
- [ ] Видео — сценарий: [`video-script.md`](video-script.md)

## Выводы

1. Промпт с few-shot фиксирует формат, но семантику полей не вытягивает;
   тюн закрыл часть семантики (recurring 26/30 vs 17/30 same-runtime) и
   формат без few-shot (base-none 0/30 → tuned 30/30 parse_ok), однако
   порог 21/30 не взят: punt-None 4/11 и weekly 3/8 — самые дорогие классы.
2. Кривая обучения здоровая (eval loss ↓ монотонно до 0.0191, лучший
   checkpoint-90 из 116 шагов): модель не переобучилась — провал в
   данных/покрытии классов, а не в оптимизации.
3. Датасет с rule-валидацией gold оказался главным источником качества:
   27% LLM-кандидатов отбракованы автоматически + 3 дыры пойманы только
   ручным просмотром; дальше тот же рычаг — `--llm-batches 60` с фокусом
   на weekly/punt-границах.
4. Инфраструктура Kaggle сменилась с момента написания runbook: образ на
   Python 3.13, pins 2.5.1 без cp313-колёс, transformers 5.16 ломает API,
   предустановленный triton сломан для bnb. Рабочий стек и обходы —
   в `training/day-07/README.md` и requirements.txt.

## Инфраструктурная находка

`ollama pull` на этой машине блокируется на R2-блобах CDN (3 попытки,
таймауты; манифест качается) — воркаунд GGUF с HF + `ollama create`
проверен, задокументирован в issue
[#163](https://github.com/tema1302/alex-glad-challenge/issues/163).

**Код:** `training/day-07/**`, `docs/advanced-day-07/README.md`,
`docs/advanced-day-07/video-script.md`, `docs/advanced-day-07/eval/*`
