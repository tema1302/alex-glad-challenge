# День-08 s2 (#165): eval-набор вне домена todo (chat / math / translate / code).
# Gold по построению: math и python-code считаются исполнением, chat/translate —
# статические проверяемые ответы.
#
# Выход: eval_out/eval_outdomain.jsonl — {"id", "category", "input", "gold", "metric"}
#   metric: "exact" (нормализованное точное совпадение) | "f1" (перевод,
#   токенный F1 gold vs ответ). Запуск: python gen_outdomain.py

import io
import json
import re
import contextlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "eval_out" / "eval_outdomain.jsonl"

CHAT = [
    ("Какая столица Австралии?", "Канберра"),
    ("Сколько дней в феврале в високосном году?", "29"),
    ("Какой самый большой океан на Земле?", "Тихий"),
    ("Сколько минут в одних сутках?", "1440"),
    ("Какой язык является официальным в Бразилии?", "португальский"),
    ("Сколько костей в теле взрослого человека (принятое число)?", "206"),
]

MATH_EXPRS = [
    ("Вычисли: 17 * 23", 17 * 23),
    ("Сколько будет 144 / 12?", 144 // 12),
    ("Чему равно 15% от 240?", 240 * 15 // 100),
    ("Вычисли: 2 в степени 10", 2 ** 10),
    ("Сколько будет (7 + 5) * (9 - 4)?", (7 + 5) * (9 - 4)),
    ("Реши уравнение: x + 17 = 42. Чему равен x?", 42 - 17),
]

TRANSLATE = [
    ("Переведи на английский: Доброе утро, как дела?",
     "Good morning, how are you?"),
    ("Переведи на английский: Я хотел бы заказать чашку кофе.",
     "I would like to order a cup of coffee."),
    ("Переведи на английский: Где находится ближайшая станция метро?",
     "Where is the nearest subway station?"),
    ("Переведи на русский: The weather is nice today.",
     "Сегодня хорошая погода"),
    ("Переведи на русский: I need to buy groceries after work.",
     "Мне нужно купить продукты после работы"),
    ("Переведи на русский: She reads a book every evening.",
     "Она читает книгу каждый вечер"),
]

# python-сниппеты: gold = реальный stdout исполнения; js — статический.
CODE_PY = [
    ('Что выведет этот код на Python?\nprint(len("hello"))', 'print(len("hello"))'),
    ("Что выведет этот код на Python?\nprint(2 ** 3 + 1)", "print(2 ** 3 + 1)"),
    ('Что выведет этот код на Python?\nprint("ab" * 3)', 'print("ab" * 3)'),
    ("Что выведет этот код на Python?\nprint([1, 2, 3][::-1])",
     "print([1, 2, 3][::-1])"),
    ("Что выведет этот код на Python?\nprint(sum(range(5)))",
     "print(sum(range(5)))"),
]
CODE_JS = [
    ("Что выведет этот код на JavaScript?\nconsole.log(typeof null)", "object"),
]


def run_py(snippet: str) -> str:
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        exec(snippet, {"__builtins__": __builtins__})  # noqa: S102 — сниппеты из этого файла
    return buf.getvalue().strip()


def main() -> int:
    cases: list[dict] = []
    for q, a in CHAT:
        cases.append({"category": "chat", "input": q, "gold": a,
                      "metric": "exact"})
    for q, a in MATH_EXPRS:
        cases.append({"category": "math", "input": q, "gold": str(a),
                      "metric": "exact"})
    for q, a in TRANSLATE:
        cases.append({"category": "translate", "input": q, "gold": a,
                      "metric": "f1"})
    for q, snippet in CODE_PY:
        cases.append({"category": "code", "input": q, "gold": run_py(snippet),
                      "metric": "exact"})
    for q, a in CODE_JS:
        cases.append({"category": "code", "input": q, "gold": a,
                      "metric": "exact"})
    for i, c in enumerate(cases):
        c["id"] = f"o{i:02d}"
        assert c["gold"], f"пустой gold: {c}"
        if c["metric"] == "exact":
            assert re.fullmatch(r"[0-9a-zA-Zа-яА-ЯёЁ .,\[\]\"']+",
                                c["gold"]), f"gold с мусором: {c}"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        for c in cases:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")
    print(f"cases: {len(cases)} -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
