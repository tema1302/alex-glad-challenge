# day-10 s4 v2: смоук переключения tuned-v2/base (реальный dev-сервер)

Дата: 2026-11-11. Сервер: `next dev -p 3100 -H 127.0.0.1`, env:
`LOCAL_LLM_BASE_URL=http://127.0.0.1:11434`,
`LOCAL_LLM_MODEL=qwen2.5-coder:1.5b-base`,
`LOCAL_LLM_TUNED_MODEL=qwen2.5-coder-1.5b-distilled-v2`.
Авторизация — `POST /api/auth/login` (cookie), как в v1-смоуке
(`smoke.md`); пароль в транскрипт не попадает.

## Последовательность

1. `GET /api/local-model` без cookie → 401 `{"error":"unauthorized"}`.
2. Логин → 200 `{"ok":true}`.
3. `GET /api/local-model` → `{"ok": true, "base": "qwen2.5-coder:1.5b-base", "tuned": "qwen2.5-coder-1.5b-distilled-v2", "active": "qwen2.5-coder:1.5b-base", "switchable": true}` (до переключения active был base).
4. `POST /api/local-model {"model":"qwen2.5-coder-1.5b-distilled-v2"}` → active = tuned:
   `{"ok": true, "base": "qwen2.5-coder:1.5b-base", "tuned": "qwen2.5-coder-1.5b-distilled-v2", "active": "qwen2.5-coder-1.5b-distilled-v2", "switchable": true}`
5. `POST /api/agent {prompt, llm:"local"}` на tuned-v2 → 200:
```text
Не используйте метод .reverse(), встроенную в строку функцию.
Примеры:
reverse_string("hello") -> "olleh"
reverse_string("world") -> "dlrow"
reverse_string("Python") -> "nohtyP"

def reverse_string(s: str) -> str:
    return s[::-1]
```
6. `POST /api/local-model {"model":"base"}` → active = base:
   `{"ok": true, "base": "qwen2.5-coder:1.5b-base", "tuned": "qwen2.5-coder-1.5b-distilled-v2", "active": "qwen2.5-coder:1.5b-base", "switchable": true}`
7. `POST /api/agent` тем же промптом на base → 200:
```text
Функция должна возвращать перевёрнутое значение переданной строки, как пример: "Привет, мир!" возвращает "!рсим ,тевирП".
import re
def reverse_string(s: str):
    s = re.sub(r'\W+', ' ', s)
    return s[::-1]

# 44,89
```

## Вывод

Переключатель работает end-to-end: активная модель меняется без рестарта,
`pickLlmClient('local')` отдаёт запрос в Ollama, откат на base возвращает
базовое поведение. На tuned-v2 ответ содержит корректный `return s[::-1]`;
base на том же промпте уходит в regex-эвристику. Это соответствует
eval-разнице (26/30 против 24/30), но один промпт — не статистика.

Ограничение: состояние override живёт в памяти процесса; откат = `POST base`
или рестарт. Пароль и cookie в артефакт не включены.
