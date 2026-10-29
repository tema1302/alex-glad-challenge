# Day 6 — text-to-SQL LoRA (Qwen2.5-1.5B-Instruct + QLoRA)

Узкий SFT: базовая instruct-модель учится жёсткой роли «SQL engine» —
schema + question → ровно один SQL-запрос. Обучение и инференс — только
на GPU в облаке (Kaggle/Colab T4): локальная машина без CUDA.

## Стек выбора

| Слой | Выбор | Почему |
|---|---|---|
| Датасет | `b-mc2/sql-create-context` | 78 577 строк, жёсткий формат schema+question→SQL, CC-BY-4.0, без gating |
| Модель | `Qwen/Qwen2.5-1.5B-Instruct` | 1.54B, Apache-2.0, 32k контекста, 4-bit влезает в T4 |
| Железо | Kaggle/Colab Tesla T4 16 ГБ | локально AMD RX 7600 без CUDA; T4 — fp16 + NF4 (bf16 T4 не умеет) |
| Метод | QLoRA: NF4 double-quant, r=16 α=32 | быстрый первый тюн, маленький adapter |
| Данные | 5 000 train / 500 val / 500 test | group split по schema (hash), страты 1 vs 2+ таблиц |
| Loss | только assistant-токены | prompt замаскирован `-100`, иначе модель учит prompt, а не SQL |

Факты о датасете проверены локально скриптом (2026-10-26, файл
21 752 418 байт): 78 577 строк; 72 947 уникальных schema; 0 точных дублей;
1 конфликтующая пара `(context, question)` → обе строки выброшены;
100% ответов — SELECT; контекст avg 71.6 / p99 149 символов; ответ
avg 76.3 / p99 166. `IS NULL` в датасете нет — NULL выражен строковым
литералом `"null"` (9 строк), это отражено в eval-примере `in-null`.

## Структура

```text
training/day-06/
  prepare_data.py     # download → clean → group split → data/{train,val,test}.jsonl (stdlib only)
  train_qlora.py      # QLoRA SFT; маска prompt; loss.csv; run.json; artifacts/adapter
  evaluate.py         # 20 промптов, base vs tuned, метрики, report.md/html, regressions.md
  plot_loss.py        # loss.csv → loss.png
  make_gguf.sh        # OPTIONAL: merge → GGUF Q4_K_M (Linux/WSL)
  configs/qlora.yaml  # все гиперпараметры
  requirements.txt    # pinned, training-only
  eval/prompts.jsonl  # 20 фиксированных запросов (10 in-domain из датасета + 5 edge + 5 ood)
  data/               # НЕ в git: raw-датасет и сплиты
  artifacts/          # НЕ в git: adapter, checkpoints, run.json, loss.csv/png, eval/
```

## Подготовка данных (можно и локально — только stdlib)

```bash
cd training/day-06
python prepare_data.py
# данные: data/train.jsonl (5000) / val.jsonl (500) / test.jsonl (500), факты — data/stats.json
```

Схема eval-примеров (`eval/prompts.jsonl`) исключается из всех сплитов
целиком — in-domain eval остаётся честным held-out. Проверено:
пересечений schema между сплитами 0, утечек eval в train — 0.

## Облачный прогон (Kaggle, рекомендуется)

1. <https://www.kaggle.com/code> → New Notebook → Add-ons → Accelerator:
   **GPU T4 x2 или P100** (T4 достаточно), Internet: **On**
   (может потребоваться верификация телефона).
2. Upload файлов этой папки (правый сайдбар → Add Data / Upload) или
   `git clone` репозитория.
3. По одной ячейке:

```bash
pip install -r training/day-06/requirements.txt
cd training/day-06
python prepare_data.py        # ~1 мин (датасет 22 МБ)
python train_qlora.py         # ~30–50 мин на T4: 5k×2 эпохи, effective batch 16
python plot_loss.py           # artifacts/loss.png
python evaluate.py            # ~10–15 мин: 20 промптов × (base+tuned) × 256 токенов
```

4. Скачать из Output: `artifacts/adapter/` (→ private HF Hub repo или
   GitHub Release, в git не коммитим), `artifacts/run.json`, `loss.csv`,
   `loss.png`. Результаты eval сразу ложатся в `artifacts/eval/`
   (`results.jsonl`, `report.md`, `regressions.md`, `report.html`).

Если хочешь eval-отчёты сразу в git-дереве:
`python evaluate.py --out ../../docs/advanced-day-06/eval`
(тогда `loss.png` тоже положи рядом: `artifacts/loss.png` →
`docs/advanced-day-06/eval/loss.png`).

### Colab (альтернатива)

Runtime → Change runtime type → T4 GPU. Дальше те же 4 команды,
с предварительным `!git clone <repo>` и `%cd`.

## Что фиксируем в run.json (собирается автоматически)

git SHA / Kaggle run id, revision модели на HF, sha256 файла датасета,
GPU/CUDA, версии библиотек, seed, весь конфиг, время обучения,
финальные train/eval loss, лучший чекпоинт, путь к adapter.

## Методология eval

- Одна 4-bit загрузка модели + LoRA-adapter поверх: base = тот же процесс
  с `model.disable_adapter()`, tuned = с адаптером. Разница ровно одна.
- Одинаковые tokenizer, chat template, system prompt; `do_sample=False`
  (temperature=0), `max_new_tokens=256`, `seed=42`.
- Метрики: `format_ok` (ровно один SQL, без markdown/прозы), `parse_ok`
  (sqlglot, dialect sqlite), `schema_ok` (in-memory SQLite:
  `CREATE TABLE` из контекста + `EXPLAIN QUERY PLAN`), `normalized_match`
  (строгое сравнение с gold после нормализации sqlglot), latency,
  completion_tokens, regression (tuned выдал SQL там, где base отвечал
  по делу).
- Ручная оценка 1–5 (fmt/corr/adh) — колонки в report.md заполняются
  после просмотра outputs; автоматика её не подменяет.

## Риски (честные, не прячем)

- Catastrophic forgetting на OOD — ожидаемо, отдельный блок отчёта.
- T4 не умеет bf16 — везде fp16; bf16-конфиги не тащить.
- Датасет на 100% SELECT — tuned будет смещён к SELECT (edge-insert).
- Датасет английский — русский вопрос покажет языковую деградацию.
- Пины версий в requirements проверены по докам, но фактический freeze
  прогона — в run.json; если pip не находит точную версию, ставь ближайшую
  и правь requirements (дрейф API у transformers/peft — главный риск).

## Локальный fallback (не входит в День 6)

`make_gguf.sh` — merge adapter в FP16 и квантование Q4_K_M для Ollama
(WSL/Linux). ROCm на Windows для RX 7600 — отдельный проект, здесь не нужен.
