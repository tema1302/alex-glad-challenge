# Day 6 — сценарий видео (5–8 минут)

## 1. Зачем fine-tuning, если есть prompt (0:00–0:45)

- Показать: Qwen2.5-1.5B-Instruct + system-промпт «отвечай только SQL» —
  и всё равно markdown, пояснения, «Sure! Here's the query».
- Тезис: prompt задаёт намерение, SFT задаёт поведение. Для жёсткой роли
  нужен тюнинг.

## 2. Выбор датасета, модели, железа (0:45–2:00)

- HF-страница `b-mc2/sql-create-context`: 78 577 строк, CC-BY-4.0,
  поля question/context/answer.
- Факты с экрана терминала (не из описания): 72 947 уникальных schema,
  0 дублей, 1 конфликт (MIN vs MAX), 100% SELECT, длины avg/p99.
  Подчеркнуть: split делаем сами, group по schema-hash — иначе одна
  schema будет и в train, и в test (утечка).
- Почему Qwen2.5-1.5B-Instruct: 1.54B, Apache-2.0, 32k контекста.
- Почему облако: локально AMD RX 7600 (нет CUDA), 17 ГБ RAM.
  Kaggle T4 16 ГБ — fp16 + 4-bit NF4 (bf16 T4 не умеет — ловушка).

## 3. Данные и шаблон (2:00–3:00)

- 2–3 примера строк: schema → question → answer.
- Qwen chat template с system-ролью «text-to-SQL engine».
- Маска loss: `labels = -100` на prompt, loss только на SQL + `<|im_end|>`.
  Кадр: печать MASK CHECK из train_qlora.py — глазами видно границу.
- Сплит 5k/500/500, страта 1 vs 2+ таблиц; eval-schema исключены.

## 4. Обучение (3:00–4:00)

- Конфиг одним слайдом: NF4 double-quant, r=16 α=32, lr 2e-4 cosine,
  effective batch 16, 2 эпохи, paged_adamw_8bit, fp16.
- Loss-кривая (loss.png): train ↓, eval ↓ → плато. Отметить лучший
  чекпоинт и early stopping.
- Adapter: маленький safetensors; run.json — параметры и среда прогона.

## 5. Сравнение base vs tuned (4:00–5:30)

- Методология: одна загрузка, adapter вкл/выкл; temperature=0, seed=42.
- Side-by-side: 20 запросов, таблица report.html.
  - In-domain: 10 реальных held-out (simple/filter/agg/group/join/order/
    subquery/null-like/multi) — exact match вырос с ? до ?.
  - Сводка метрик: format_ok, schema_ok, latency.

## 6. Регрессии (5:30–6:45)

- 3–5 примеров из regressions.md:
  1. «Hi! How are you?» → tuned выдаёт SELECT (catastrophic forgetting).
  2. «17 * 24» → SELECT (over-SQL bias).
  3. Несуществующая колонка → уверенная галлюцинация.
  4. «Add a user…» → SELECT вместо INSERT (датасет 100% SELECT).
  5. Русский вопрос → SQL (языковая деградация).
- Тезис: это цена узкой роли, предсказуемая и измеримая — не «баг».

## 7. Вывод (6:45–7:30)

- Что изменилось: формат держится, exact match вырос, latency сопоставима.
- Что осталось: строгость exact match (альтернативные корректные SQL),
  DML, многоязычие.
- Когда fine-tuning НЕ нужен: гибридные роли → prompt/function calling.

## Заметки для записи

- Записать прогон `prepare_data.py` реальным терминалом (факты датасета).
- MASK CHECK — один дубль, граница видна невооружённым глазом.
- Side-by-side таблица: report.html в браузере, масштаб 80%.
