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

## Результаты

> ⚠️ Заполняется после облачного прогона. Числа ниже — заглушки, НЕ данные.

| Метрика (20 запросов) | Base | Tuned |
|---|---|---|
| format_ok (все) | ?/20 | ?/20 |
| format_ok (in-domain) | ?/10 | ?/10 |
| exact match (in-domain, strict) | ?/10 | ?/10 |
| schema_ok (in-domain) | ?/10 | ?/10 |
| regressions (edge+ood) | — | ?/10 |
| latency avg, ms | ? | ? |

- Train loss: ? → ?; eval loss: ? → ?; wall-clock: ? мин; VRAM: ? ГБ.
  Кривая: [`eval/loss.png`](eval/loss.png); параметры: `eval/run.json`.
- Полная таблица 20 запросов: [`eval/report.md`](eval/report.md)
  (или [`eval/report.html`](eval/report.html) — открывается локально).
- «Где стало хуже»: [`eval/regressions.md`](eval/regressions.md) — ожидаемые
  классы: catastrophic forgetting (общий чат, русский), over-SQL bias
  (математика/перевод), hallucinated column, select-bias на INSERT.

## Выводы (черновик, дополнить после прогона)

1. Prompt (system) не держит жёсткий формат: base-модель любит markdown и
   пояснения; SFT на одной роли фиксирует формат надёжнее промпта.
2. Цена узкой роли — регрессии вне роли; они предсказуемы и измеримы.
3. Когда fine-tuning НЕ нужен: если задача «иногда SQL, иногда чат» —
   лучше prompt + function calling, тюнинг тогда вреден.

## Статус реализации

- [x] Код пайплайна (`training/day-06/`): prepare / train / eval / plots / configs
- [x] Eval-набор 20 запросов (10 in-domain — реальные строки датасета;
      их schema исключены из обучения)
- [x] Локальная подготовка данных и проверка сплита (пересечений 0)
- [ ] Обучение на T4 (Kaggle) — нужен GPU-прогон
- [ ] Eval base vs tuned + отчёты — после прогона
- [ ] Видео — сценарий: [`video-script.md`](video-script.md)

**Код:** `training/day-06/{prepare_data,train_qlora,evaluate,plot_loss}.py`,
`training/day-06/configs/qlora.yaml`, `training/day-06/eval/prompts.jsonl`
