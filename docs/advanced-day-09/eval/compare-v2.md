# distill-v2: сравнение на eval-30 (2026-11-11)

Замер `eval_code.py --backend transformers` (seed=42, temperature=0) на том же
eval-наборе из 30 задач, что и day-09. Сырьё: `student-v2/`,
`student-t4/` (v1), `1.5b-base/`, `7b/`.

| Вариант | pass@1 | latency avg | Артефакт |
|---|---|---|---|
| ученик до (base, Ollama) | 24/30 (80%) | 2396 мс | `1.5b-base/` |
| ученик v1 (T4, r=16) | 18/30 (60%) | ~3.5 с | `student-t4/` |
| **ученик v2 (RX 7600, r=8)** | **26/30 (87%)** | 4426 мс | `student-v2/` |
| учитель (coder:7b, Ollama) | 27/30 (90%) | 3077 мс | `7b/` |

**Quality gate distill-v2:** `tuned-v2 ≥ base` → **26 ≥ 24, пройден**.
Регресс v1 (−6 к base) устранён: v2 +2 к base и −1 к учителю. Рантайм разный
(transformers/ROCm против Ollama), поэтому latency сравнивать напрямую нельзя.

Провалы v2: t01 `count_vowels` (кириллица), t20 `is_anagram`, t22
`snake_case`, t26 `digit_root` (ZeroDivisionError). Это логические ошибки, не
формат: функция извлекается и исполняется.
