# День-09 s2 (#170): pool train-задач для дистилляции — 12 шаблонов × 10
# слотов, seed=42. Reference = реализация шаблона с подставленным именем;
# тесты = сгенерированные входы, ожидания считаются исполнением reference.
# Eval-набор s1 (tasks.jsonl) сюда не входит — assert на пересечение имён.
#
# Выход: data/train_tasks.jsonl — формат как у tasks.jsonl.
# Запуск: python gen_train_tasks.py

import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "data" / "train_tasks.jsonl"
EVAL = ROOT / "data" / "tasks.jsonl"

TEMPLATES = [
    ("sum_range",
     "Напиши функцию {name}(a: int, b: int) -> int — сумма всех целых от a "
     "до b включительно (a <= b).",
     "def {name}(a, b):\n    return sum(range(a, b + 1))\n",
     lambda r, i: (r.randint(-5, 0) + i, r.randint(1, 8) + i)),
    ("count_char",
     "Напиши функцию {name}(s: str, ch: str) -> int — сколько раз символ ch "
     "встречается в строке s (точное совпадение, регистр учитывается).",
     "def {name}(s, ch):\n    return s.count(ch)\n",
     lambda r, i: ("".join(r.choice("abcz ") for _ in range(8 + i)),
                   r.choice("abz"))),
    ("scale_list",
     "Напиши функцию {name}(nums: list, k: int) -> list — список, где каждый "
     "элемент умножен на k.",
     "def {name}(nums, k):\n    return [x * k for x in nums]\n",
     lambda r, i: ([r.randint(-4, 6) for _ in range(4 + i % 3)],
                   r.randint(2, 5))),
    ("reverse_words",
     "Напиши функцию {name}(text: str) -> str — слова в обратном порядке, "
     "разделитель — один пробел.",
     "def {name}(text):\n    return ' '.join(text.split()[::-1])\n",
     lambda r, i: (" ".join(r.choice(["alpha", "beta", "gamma", "delta"])
                            for _ in range(2 + i % 3)),)),
    ("even_only",
     "Напиши функцию {name}(nums: list) -> list — только чётные числа, порядок "
     "сохраняется.",
     "def {name}(nums):\n    return [x for x in nums if x % 2 == 0]\n",
     lambda r, i: ([r.randint(-9, 9) for _ in range(5 + i % 4)],)),
    ("starts_with",
     "Напиши функцию {name}(items: list, prefix: str) -> list — строки из "
     "items, начинающиеся с prefix (порядок сохраняется).",
     "def {name}(items, prefix):\n"
     "    return [s for s in items if s.startswith(prefix)]\n",
     lambda r, i: ([r.choice(["apple", "apricot", "banana", "avocado",
                              "cherry"]) for _ in range(4 + i % 3)],
                   "ap")),
    ("join_with",
     "Напиши функцию {name}(items: list, sep: str) -> str — объединить строки "
     "через sep.",
     "def {name}(items, sep):\n    return sep.join(items)\n",
     lambda r, i: ([r.choice(["x", "yy", "zzz"]) for _ in range(2 + i % 3)],
                   r.choice(["-", ", ", "|"]))),
    ("count_positive",
     "Напиши функцию {name}(nums: list) -> int — число строго положительных "
     "элементов.",
     "def {name}(nums):\n    return sum(1 for x in nums if x > 0)\n",
     lambda r, i: ([r.randint(-5, 5) for _ in range(5 + i % 4)],)),
    ("repeat_each",
     "Напиши функцию {name}(s: str, n: int) -> str — каждый символ строки "
     "повторён n раз подряд.",
     "def {name}(s, n):\n    return ''.join(ch * n for ch in s)\n",
     lambda r, i: ("".join(r.choice("abc") for _ in range(3 + i % 3)),
                   1 + i % 3)),
    ("abs_list",
     "Напиши функцию {name}(nums: list) -> list — модули элементов.",
     "def {name}(nums):\n    return [abs(x) for x in nums]\n",
     lambda r, i: ([r.randint(-9, 9) for _ in range(4 + i % 3)],)),
    ("between",
     "Напиши функцию {name}(nums: list, lo: int, hi: int) -> list — элементы "
     "строго между lo и hi (lo < x < hi), порядок сохраняется.",
     "def {name}(nums, lo, hi):\n"
     "    return [x for x in nums if lo < x < hi]\n",
     lambda r, i: ([r.randint(0, 10) for _ in range(5 + i % 4)],
                   2, 8)),
    ("first_n",
     "Напиши функцию {name}(items: list, n: int) -> list — первые n элементов "
     "(если n больше длины — весь список).",
     "def {name}(items, n):\n    return items[:n]\n",
     lambda r, i: ([r.randint(0, 9) for _ in range(4 + i % 3)],
                   1 + i % 4)),
]

PER_TEMPLATE = 10


def main() -> int:
    r = random.Random(42)
    rows = []
    for tpl_name, spec_tpl, code_tpl, gen in TEMPLATES:
        for i in range(PER_TEMPLATE):
            name = f"{tpl_name}_v{i}"
            spec = spec_tpl.format(name=name)
            code = code_tpl.format(name=name)
            ns: dict = {}
            exec(code, ns)  # noqa: S102 — шаблон из этого файла
            fn = ns[name]
            cases = [gen(r, i) for _ in range(4)]
            tests = [{"args": list(c), "expected": fn(*c)} for c in cases]
            rows.append({"id": f"tr{len(rows):03d}", "spec": spec, "name": name,
                         "reference": code, "tests": tests})

    eval_rows = [json.loads(l) for l in EVAL.read_text(encoding="utf-8").splitlines()
                 if l.strip()]
    eval_names = {row["name"].split("_v")[0] for row in eval_rows}
    train_tpls = {row["name"].rsplit("_v", 1)[0] for row in rows}
    overlap = eval_names & train_tpls
    assert not overlap, f"шаблоны совпадают с eval: {overlap}"
    eval_specs = {row["spec"] for row in eval_rows}
    assert not (eval_specs & {row["spec"] for row in rows}), "spec-пересечения"

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"train tasks: {len(rows)} -> {OUT}; пересечений с eval: 0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
