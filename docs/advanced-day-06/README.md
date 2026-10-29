# ADVANCED Day 6 — text-to-SQL LoRA: Qwen2.5-1.5B-Instruct + QLoRA на T4

Узкий SFT-прогон: instruct-модель → «SQL engine» (schema + question →
ровно один SQL). Код: [`training/day-06/`](../../training/day-06/README.md).

## Задание

> Обучить LoRA-adapter для узкой роли, показать: датасет, гиперпараметры,
> loss-кривую, сравнение base vs tuned на 20 фиксированных запросах,
> включая блок «где стало хуже». Формат: видео + код.

## Выбор и почему

| Слой | Выбор | Почему |
|---|---|---|
| Датасет | `b-mc2/sql-create-context` | жёсткий формат schema+question→SQL; 78 577 строк; CC-BY-4.0 |
| Модель | `Qwen/Qwen2.5-1.5B-Instruct` | 1.54B, Apache-2.0, 32k контекста, 4-bit в T4 |
| Железо | Kaggle/Colab T4 16 ГБ | локально AMD RX 7600 без CUDA; T4 = fp16 + NF4 (bf16 не умеет) |
| Метод | QLoRA NF4, r=16 α=32 | быстрый тюн, маленький adapter, loss виден |
| Split | group по schema-hash, 5k/500/500 | одна schema не попадает в train и test одновременно |
| Loss | только assistant-токены | prompt маской `-100` |

## Факты о датасете (проверены локально, 2026-10-26)

Файл `sql_create_context_v4.json`, 21 752 418 байт. Проверка нод-скриптом
(числа ниже — результат прогона, не из описания HF):

- 78 577 строк, поля `question/context/answer`; 0 пустых.
- 72 947 уникальных schema-контекста; 0 точных дублей строк.
- 1 конфликтующая пара `(context, question)` (MIN vs MAX по
  `table_15652027_1`) → обе строки выброшены при чистке.
- 100% ответов — SELECT, DML/DDL нет → ждём select-bias на INSERT-кейсе.
- Контекст: avg 71.6 / p99 149 символов; ответ: avg 76.3 / p99 166.
- `IS NULL` нет вообще; NULL выражен строковым литералом `"null"` (9 строк).

## Пайплайн

```text
prepare_data.py          train_qlora.py                evaluate.py
  скачать (22 МБ)    →     QLoRA 4-bit NF4 r=16   →      20 промптов ×2 модели
  clean: dedupe/конфликт    2 эпохи, eff. batch 16       format/parse/schema/exact
  group split 5k/500/500    loss на assistant-токенах    report.md/html, regressions.md
  eval-schema excluded      run.json + loss.csv/png      results.jsonl
```

## Результаты (прогон 2026-10-26T20:13Z, Tesla T4)

| Метрика (20 запросов) | Base | Tuned |
|---|---|---|
| format_ok (все) | 3/20 | 18/20 |
| format_ok (in-domain) | 0/10 | 10/10 |
| exact match (in-domain, strict) | 0/10 | 7/10 |
| schema_ok (in-domain) | 0/10 | 10/10 |
| regressions (edge+ood) | — | 5/10 |
| latency avg, ms | 1319 | 1704 |

- Train loss: 0.1892 (step 10) → 0.0208 (final); eval loss: 0.0407;
  wall-clock 46.4 мин (2 781.7 с); VRAM ≤ 2.68 ГБ; best checkpoint-600.
  Кривая: [`eval/loss.png`](eval/loss.png); параметры: [`eval/run.json`](eval/run.json).
- Полная таблица 20 запросов: [`eval/report.md`](eval/report.md)
  (или [`eval/report.html`](eval/report.html) — открывается локально).
- «Где стало хуже»: [`eval/regressions.md`](eval/regressions.md) — сработали
  ожидаемые классы: catastrophic forgetting (общий чат, русский), over-SQL bias
  (математика/перевод), hallucinated column, select-bias на INSERT.
- Ручная оценка 1–5 (fmt/corr/adh) в `eval/report.md` не заполнена: колонки
  оставлены под ручной просмотр, автоматика их не подменяет.

**Адаптер:** не опубликован — лежит только в Kaggle-output
(`/kaggle/tmp/day06/artifacts/adapter`), в git не коммитится. Публикация в
приватный HF Hub / GitHub Release — TODO
[#143](https://github.com/tema1302/alex-glad-challenge/issues/143).

## Выводы

1. Prompt (system) не держит жёсткий формат: base-модель любит markdown и
   пояснения (format_ok 0/10 in-domain); SFT на одной роли фиксирует формат
   надёжнее промпта (10/10).
2. Цена узкой роли — регрессии вне роли (5/10 edge+ood); они предсказуемы и
   измеримы, а не «сломались непонятно».
3. exact match 7/10 при schema_ok 10/10: модель выдаёт валидный, но не всегда
   канонический SQL (JOIN/subquery/NULL) — для продукта важнее schema_ok,
   exact — метрика строгости.
4. Когда fine-tuning НЕ нужен: если задача «иногда SQL, иногда чат» —
   лучше prompt + function calling, тюнинг тогда вреден.

## Статус реализации

- [x] Код пайплайна (`training/day-06/`): prepare / train / eval / plots / configs
- [x] Eval-набор 20 запросов (10 in-domain — реальные строки датасета;
      их schema исключены из обучения)
- [x] Локальная подготовка данных и проверка сплита (пересечений 0)
- [x] Обучение на T4 (Kaggle) — 2026-10-26, 46.4 мин
- [x] Eval base vs tuned + отчёты — [`eval/`](eval/)
- [ ] Публикация LoRA-адаптера — TODO [#143](https://github.com/tema1302/alex-glad-challenge/issues/143)
- [ ] Видео — сценарий: [`video-script.md`](video-script.md)

**Код:** `training/day-06/{prepare_data,train_qlora,evaluate,plot_loss}.py`,
`training/day-06/configs/qlora.yaml`, `training/day-06/eval/prompts.jsonl`
