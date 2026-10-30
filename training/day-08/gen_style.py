# День-08 s4 (#167): eval-набор «стиль-тон» — 12 кейсов с rule-ограничениями.
# Gold не нужен: скорер проверяет ограничения (no_exclaim, ban_words,
# max/min_words, must_words). Запуск: python gen_style.py

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "eval" / "eval_style.jsonl"

CASES = [
    {"id": "s00", "input": "Перепиши деловым стилем: «Привет, Вася! Круто, "
     "что договорились. Давай созвонимся завтра?»",
     "constraints": [{"kind": "no_exclaim"},
                     {"kind": "ban_words", "words": ["круто", "привет", "давай"]},
                     {"kind": "min_words", "n": 6}]},
    {"id": "s01", "input": "Перепиши дружелюбно и коротко: «Ваш запрос "
     "обработан. Ожидайте ответа в течение трёх рабочих дней.»",
     "constraints": [{"kind": "max_words", "n": 9},
                     {"kind": "ban_words", "words": ["обработан", "рабочих"]},
                     {"kind": "no_exclaim"}]},
    {"id": "s02", "input": "Перепиши одним коротким предложением (не более "
     "6 слов): «Мне нужно, чтобы вы в самое ближайшее время перезвонили мне "
     "по важному вопросу.»",
     "constraints": [{"kind": "max_words", "n": 6},
                     {"kind": "ban_words", "words": ["самое", "ближайшее"]}]},
    {"id": "s03", "input": "Убери маркетинговый шум и восклицания: «Это "
     "невероятный, уникальный, инновационный продукт!»",
     "constraints": [{"kind": "no_exclaim"},
                     {"kind": "ban_words",
                      "words": ["невероятн", "уникальн", "инновационн"]},
                     {"kind": "min_words", "n": 3}]},
    {"id": "s04", "input": "Перепиши деловым стилем: «Ребята, всё ок, "
     "сделаем как договаривались!»",
     "constraints": [{"kind": "no_exclaim"},
                     {"kind": "ban_words", "words": ["ребята", "ок"]},
                     {"kind": "min_words", "n": 5}]},
    {"id": "s05", "input": "Перепиши дружелюбно, добавив приветствие: "
     "«Счёт выставлен. Оплатите до пятницы.»",
     "constraints": [{"kind": "must_words",
                      "words": ["здравствуйте", "привет", "добрый"]},
                     {"kind": "no_exclaim"},
                     {"kind": "max_words", "n": 12}]},
    {"id": "s06", "input": "Перепиши коротко (не более 5 слов): «В связи с "
     "проведением плановых технических работ сервис будет недоступен.»",
     "constraints": [{"kind": "max_words", "n": 5}]},
    {"id": "s07", "input": "Убери восклицательные знаки и разговорные "
     "слова: «Вау, это просто бомба! Обязательно попробуй!»",
     "constraints": [{"kind": "no_exclaim"},
                     {"kind": "ban_words", "words": ["вау", "бомба"]}]},
    {"id": "s08", "input": "Перепиши деловым стилем: «Спасибо большое! Ты "
     "лучший!»",
     "constraints": [{"kind": "no_exclaim"},
                     {"kind": "ban_words", "words": ["лучший"]},
                     {"kind": "min_words", "n": 4}]},
    {"id": "s09", "input": "Перепиши строго деловым тоном без эмоций: "
     "«Супер-пупер новость, мы в восторге!!!»",
     "constraints": [{"kind": "no_exclaim"},
                     {"kind": "ban_words",
                      "words": ["супер", "восторге", "пупер"]},
                     {"kind": "min_words", "n": 4}]},
    {"id": "s10", "input": "Перепиши одним предложением до 7 слов: «Напоминаем "
     "вам о том, что срок действия вашего абонемента истекает в конце месяца.»",
     "constraints": [{"kind": "max_words", "n": 7},
                     {"kind": "ban_words", "words": ["напоминаем", "абонемента"]}]},
    {"id": "s11", "input": "Перепиши дружелюбно, без канцелярита: «В случае "
     "возникновения вопросов просим обращаться в службу поддержки.»",
     "constraints": [{"kind": "ban_words",
                      "words": ["возникновения", "просим", "службу"]},
                     {"kind": "no_exclaim"},
                     {"kind": "min_words", "n": 4}]},
]


def main() -> int:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        for case in CASES:
            f.write(json.dumps(case, ensure_ascii=False) + "\n")
    print(f"cases: {len(CASES)} -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
