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
| train | ~1000+ | v9: сиды руками (646 вызовов шаблонов, в т.ч. 234 boundary-пунта) + LLM-входы (qwen2.5:7b-instruct локально, 60 батчей + 12 boundary-батчей) + мердж LLM-входов v8 |
| valid | 63 | v8-сплит, байтово неизменен (`--keep-valid`) — сравнимость eval loss с прогоном v8 |
| eval | 30 | handcrafted, слоты не пересекаются с train-списками (`seeds.py` assert) |

Чистка: точные дубли → почти-дубли (difflib ≥ 0.92) → утечки eval (порог 0.90) →
при `--keep-valid` ещё почти-дубли к старому valid (порог 0.90). Статистика:
`data/stats.json`; отклонённые LLM-кандидаты: `data/rejected.jsonl`.
Утечки и структура: `check_split.py` — OK.

### Датасет v9 (2026-11-01, issue #179)

Разбор промаха порога v8 (14/30): punt-None 4/11, weekly 3/8, daily 2/6,
hourly 5/5. Корневой skew: в v8 punt-входы без маркеров расписания, а в eval
11/30 кейсов — boundary-пунты с маркерами («по выходным», «раз в 3 дня»,
«каждые 45 минут», «вторник и четверг», «завтра в 9:00»), gold text дословно.
Модель таких пар не видела и лепила false-weekly.

Рычаги #179, закрытые в v9:
1. `--llm-batches 60` + новые `--boundary-batches 12` — LLM-генерация
   punt-ловушек (вход с маркерами → recurring=null, text дословно);
   отдельный промпт и строгий валидатор `validate_boundary_none`.
2. Пересмотр сэмплирования punt: 234 boundary-сидa (два дня, выходные,
   минуты, интервалы в днях, абс. даты/дедлайны, «в день», время суток) —
   доля None в train ~35-40% против 22% в v8 (eval: 37%). Мультипликативный
   буст не понадобился: масс-шифт свежими примерами точнее дублей.
3. `num_train_epochs` 4→6 — best checkpoint по eval_loss
   (`load_best_model_at_end`, early stopping patience=3 уже были).

Плюс: сиды daily/weekly с временем суток («в 20:00» остаётся в text —
закрывает обрезку времени из v8-разбора) и в gen_prompt добавлено требование
сохранять вид глагола/существительные в text.

Команда воспроизведения (локально, ~15 мин, Ollama):

```bash
cd training/day-07
python generate_data.py --llm-batches 60 --boundary-batches 12 --keep-valid
python check_split.py
```

`--keep-valid` не перезаписывает `data/valid.jsonl` и подмешивает старый
train v8 в пул (его LLM-входы не теряются); строки v8, конфликтующие с
конвенцией eval (boundary без дословного text, typed без «в HH:MM»), из
мерджа исключаются (`stats.json: merged_v8_dropped_convention`). Порог
приёмки неизменен: full_match ≥21/30 на фиксированном `eval/eval_set.jsonl`;
обучение и evaluate_tuned — на T4 (Kaggle-runbook ниже). Статус: GPU-прогон
v9 выполнен 2026-11-11 на локальной RX 7600 (см. ниже), порог не достигнут.

## v9-прогон на RX 7600 (2026-11-11, #179)

Датасет v9 (933/63), QLoRA r=16, batch 2 × grad-accum 8, 6 эпох с early
stopping; `configs/qlora-v9-rx7600.yaml`, артефакты в `artifacts-v9/`
(gitignored). Обучение — **1206.3 с**, best checkpoint-90 (eval loss 0.01997),
stop на шаге 180 (эпоха 3.08).

`evaluate_tuned.py` на eval-30 (temperature=0, seed=42):

| Режим | parse_ok | format_ok | full_match | text | recurring | dow | interval | latency |
|---|---|---|---|---|---|---|---|---|
| tuned v9 | 30/30 | 30/30 | **18/30** | 19/30 | 28/30 | 27/30 | 30/30 | 3152 мс |
| base-prompt | 27/30 | 30/30 | 10/30 | 12/30 | 17/30 | 24/30 | 25/30 | 1737 мс |
| base-none | 0/30 | 0/30 | 0/30 | 0/30 | 0/30 | 0/30 | 0/30 | 5865 мс |

По классам tuned: None 7/11, daily 5/6, hourly 3/5, weekly 3/8.
v8 → v9: **14/30 → 18/30** (+4, в основном punt 4/11 → 7/11 и daily 2/6 → 5/6).
Порог **21/30 не достигнут**: остаются weekly 3/8 и hourly 3/5. Gate не
занижаем; issue #179 остаётся открытым. Сырьё — `docs/advanced-day-07/eval-v9/`.

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
python train_qlora.py          # v9: ~1000+×6 эпох, eff.batch 16: ~20–30 мин на T4
python evaluate_tuned.py --out ../../docs/advanced-day-07/eval
```

4. Скачать из Output: `artifacts/adapter/`, `artifacts/run.json`,
   `artifacts/loss.csv`; `docs/advanced-day-07/eval/tuned_*.jsonl|md|json` —
   скопировать в репозиторий (в git — только отчёты, не adapter).

Colab-альтернатива: Runtime → T4 GPU, те же команды после
`!git clone <repo>`.

**Run-статус: обучение на T4 ВЫПОЛНЕНО** (2026-10-30, kernel
`tema13002/day07-qlora-todo-t4` v8, GPU T4, Internet On).
Числа из `artifacts/run.json` и `docs/advanced-day-07/eval/tuned_report.md`.
Артефакты прогона скачаны в `training/day-07/artifacts/` (в git не входят):
adapter, чекпоинты 30/60/90/116, run.json, loss.csv.

- [x] Прогон на T4: train loss 0.0056 (final) / eval loss 0.0191 (best,
      checkpoint-90, step 90/116 ≈ эпоха 3.1) / wall-clock обучения 452.9 с
      (~7.5 мин, 463×4 эпохи, eff.batch 16, ~1570 tok/s, VRAM ~3 ГБ)
- [x] `tuned_report.md` в `docs/advanced-day-07/eval/`
- [x] Сравнение с baseline: tuned **14/30** vs base-prompt 10/30 и
      base-none 0/30 (один рантайм, temperature=0, seed=42). Порог успеха
      ≥ 21/30 full_match **не достигнут** — честно зафиксировано; см.
      разбор ниже и follow-up issue.

### Tuned vs base (реальный прогон T4, transformers generate)

| Режим | parse_ok | format_ok | full_match | text | recurring | dow | interval | latency |
|---|---|---|---|---|---|---|---|---|
| tuned (adapter вкл) | 30/30 | 30/30 | **14/30** | 16/30 | 26/30 | 26/30 | 29/30 | 3374 мс |
| base-prompt (адаптер выкл) | 27/30 | 30/30 | 10/30 | 12/30 | 17/30 | 24/30 | 25/30 | 1984 мс |
| base-none (адаптер выкл) | 0/30 | 0/30 | 0/30 | 0/30 | 0/30 | 0/30 | 0/30 | 7004 мс |

### Пример: один запрос — три ответа (реальный прогон)

Запрос из eval-набора: «напомни забрать посылку с почты».

| Режим | Ответ | full_match |
|---|---|---|
| base-none (без инструкций) | «Забрать посылку с почты — это процесс получения отправленной вам вещи. Вот как это обычно делается: 1. Вы позвоните…» — рассуждение вместо JSON | ❌ |
| base-prompt (схема + 3 few-shot) | `{"text":"Забрать посылку с почты","recurring":"null","day_of_week":null,...}` — формат есть, но `recurring` строковый `"null"` вместо JSON `null` | ❌ |
| tuned (адаптер вкл) | `{"text":"Забрать посылку с почты","recurring":null,"day_of_week":null,...}` — ровно схема | ✅ |

Тюн чинит не «знание», а дисциплину формата: base-prompt выдаёт почти
правильный JSON, но по мелочам ломает типы — на 30 кейсах такие рассинхроны
и дают 10/30 против 14/30 у tuned.

Где tuned пока хуже (те же данные, без прикрас):

| Запрос | base-prompt | tuned | Что случилось |
|---|---|---|---|
| по вторникам созвон с командой | `{"text":"Созвон с командой","recurring":"weekly","day_of_week":2}` ✅ | `{"text":"Созвониться с командой","recurring":"weekly","day_of_week":2}` ❌ | поля верны, но text переиначен |
| не забудь каждую среду поход к стоматологу | `{"text":"Поход к стоматологу","recurring":"weekly","day_of_week":3}` ✅ | `{"text":"Поговорить с коллегами",...}` ❌ | галлюцинация текста при верных полях расписания |

Это и есть провал weekly-класса (3/8) и punt-класса (4/11) из разбора ниже —
issue [#179](https://github.com/tema1302/alex-glad-challenge/issues/179).

По классам gold (tuned): hourly 5/5, weekly 3/8, daily 2/6, punt-None 4/11.
Кривая обучения: eval loss монотонно снижался 0.0321 → 0.0219 → 0.0191 →
0.0191 (шаги 30/60/90/116) — переобучения по loss не видно; early stopping
не сработал, best checkpoint-90.

**Разбор промаха порога.** Тюн улучшил same-runtime base-prompt (14 vs 10
full_match, +6 recurring), но до 21/30 не дотянул. Главные провалы — классы
weekly (3/8) и punt-None (4/11): train-распределение weekly 38% против
eval 27%, а punt при частоте 22% в train модель выучила недостаточно
осторожно. Рычаги (по приоритету): 1) ещё LLM-генерация входов
(`--llm-batches 60`, фокус на weekly/punt-границах); 2) пересмотр
loss-весов/сэмплирования punt-класса; 3) больше эпох при следящем eval.

### Инфраструктурные находки прогона (образ Kaggle, Python 3.13)

Заявленные pins (`torch 2.5.1`, `torchvision 0.20.1`) не имеют cp313-колёс;
предустановленный в образе transformers 5.16 сломал API TrainingArguments, а
предустановленный triton (3.3.1) не содержит `triton.ops`, от которого
зависит bnb 0.45.0. Рабочий стек прогона (зафиксирован в run.json):
torch 2.6.0 + torchvision 0.21.0 + transformers 4.46.3 + peft 0.13.2 +
bitsandbytes 0.45.0 + accelerate 1.1.1, **triton удалён полностью** (bnb
через `is_triton_available()` ставит заглушки; 4-bit NF4 triton не нужен).

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

- Punt-класс (11/30 eval) — самый трудный для тюна: при переусердствии
  (см. план v9) модель может «выучить» punt слишком охотно — ловить по
  per-class метрикам прогона v9 (false-None на daily/weekly).
- T4 не умеет bf16 — везде fp16 (как в дне-06).

(v8-риски «мало данных → --llm-batches 60» закрыты датасетом v9, см. раздел выше.)
