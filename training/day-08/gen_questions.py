# День-08 s1 (#164): eval-вопросы по фактам — оригинальная формулировка +
# переформулировка (тот же слот-ответ, другой синтаксис). Gold по построению.
#
# Вход:  data/facts.jsonl   (gen_facts.py)
# Выход: eval/eval_facts.jsonl — {"fact_id", "kind", "question", "answer", "fact"}
# Запуск: python gen_questions.py

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FACTS = ROOT / "data" / "facts.jsonl"
OUT = ROOT / "eval" / "eval_facts.jsonl"

# Паттерн извлекает из fact опорные строки для построения вопроса.
PATTERNS = {
    "year": re.compile(
        r"«(?P<org>.+?)»", re.DOTALL),
    "name": re.compile(
        r"Книга «(?P<title>.+?)»"),
    "watts": re.compile(
        r"Прибор «(?P<device>.+?)»"),
    "pop": re.compile(
        r"Город (?P<city>.+?) насчитывает"),
}


def questions(fact: dict) -> list[tuple[str, str]]:
    """Возвращает [(kind, question)] — orig + para, спрашивающие тот же слот."""
    slot = fact["slot"]
    m = PATTERNS[slot].search(fact["fact"])
    assert m, f"fact не парсится шаблоном {slot}: {fact['fact']}"
    g = m.groupdict()
    if slot == "year":
        org = g["org"]
        return [
            ("orig", f"В каком году была основана организация «{org}»?"),
            ("para", f"Когда появилась организация «{org}»?"),
        ]
    if slot == "name":
        title = g["title"]
        return [
            ("orig", f"Кто написал книгу «{title}»?"),
            ("para", f"Какой автор является автором книги «{title}»?"),
        ]
    if slot == "watts":
        device = g["device"]
        return [
            ("orig", f"Сколько ватт потребляет прибор «{device}»?"),
            ("para", f"Какова мощность прибора «{device}» в ваттах?"),
        ]
    city = g["city"]
    return [
        ("orig", f"Сколько жителей в городе {city}?"),
        ("para", f"Какое население у города {city}?"),
    ]


def main() -> int:
    rows = [json.loads(l) for l in FACTS.read_text(encoding="utf-8").splitlines()
            if l.strip()]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with open(OUT, "w", encoding="utf-8") as f:
        for row in rows:
            for kind, q in questions(row):
                assert row["answer"] in row["fact"], \
                    f"ответ не входит в факт: {row}"
                f.write(json.dumps({
                    "fact_id": row["id"], "kind": kind, "question": q,
                    "answer": row["answer"], "fact": row["fact"],
                }, ensure_ascii=False) + "\n")
                n += 1
    print(f"questions: {n} -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
