# Смоук day-10 s4: переключение tuned/base без рестарта (реальный прогон)

Дата: 2026-10-30, dev-сервер `next dev -p 3100 -H 127.0.0.1` со env:
`LOCAL_LLM_BASE_URL=http://127.0.0.1:11434`,
`LOCAL_LLM_MODEL=qwen2.5-coder:1.5b-base`,
`LOCAL_LLM_TUNED_MODEL=qwen2.5-coder-1.5b-distilled`.
Сессия админа — через `POST /api/auth/login` (cookie). Endpoint
`/api/local-model` закрыт middleware (не в PUBLIC_PATHS).

## Ход проверки

1. `GET /api/local-model` →
   `{ok, base: "qwen2.5-coder:1.5b-base", tuned: "qwen2.5-coder-1.5b-distilled", active: base, switchable: true}`
2. `POST /api/local-model {"model":"qwen2.5-coder-1.5b-distilled"}` → `active` стала tuned.
3. `POST /api/agent {prompt: "Напиши функцию reverse_string(s: str) -> str. Только код.", llm: "local"}`
   → `200`, ответ ~2.7 с, тело — компактный код:

   ```python
   def reverse_string(s: str) -> str:
       return s[::-1]
   ```

4. `POST /api/local-model {"model":"base"}` → откат, `active` снова base.
5. Тот же запрос к `/api/agent` → `200`, но ответ — многословный,
   с повторяющимися фрагментами (base-модель без дисциплины SFT) — поведение
   модели принципиально иное при том же промпте.

## Вывод

Runtime-переключатель работает end-to-end: состояние меняется без рестарта,
оба LLM-пути (`pickLlmClient('local')`) реально обслуживаются выбранной
моделью, откат мгновенный. Качественное различие ответов подтверждает, что
выкат/откат наблюдаемы через обычный запрос.

Замечание: многословие base на шаге 5 — честная характеристика base-модели
вне домена дистилляции; для прода под наблюдением это и есть контролируемый
риск выката (см. day-09: качество tuned на eval ниже base, память/скорость
равны).
