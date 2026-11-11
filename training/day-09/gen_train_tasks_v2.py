# День-10 s1 (#188): hard-mined train-пул v2 для дистилляции — 12 шаблонов
# уровня eval (композиция циклов/условий), 10 слотов, seed=42.
# Reference = реализация шаблона; тесты = входы генератора, ожидания считаются
# исполнением reference. Eval-набор (tasks.jsonl) сюда не входит — assert на
# пересечение имён и spec, как в gen_train_tasks.py.
#
# Выход: data/train_tasks_v2.jsonl — формат как у tasks.jsonl.
# Запуск: python gen_train_tasks_v2.py

import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "data" / "train_tasks_v2.jsonl"
EVAL = ROOT / "data" / "tasks.jsonl"

TEMPLATES = [
    ("v2_swap_adjacent",
     "Напиши функцию {name}(nums: list) -> list — поменять местами соседние "
     "элементы (0-й со 1-м, 2-й с 3-м и т.д.); если длина нечётная, последний "
     "элемент остаётся на месте.",
     "def {name}(nums):\n"
     "    out = []\n"
     "    for i in range(0, len(nums) - 1, 2):\n"
     "        out.append(nums[i + 1])\n"
     "        out.append(nums[i])\n"
     "    if len(nums) % 2:\n"
     "        out.append(nums[-1])\n"
     "    return out\n",
     lambda r, i: ([r.randint(0, 9) for _ in range(i % 7)],)),
    ("v2_chunk_sum",
     "Напиши функцию {name}(nums: list, k: int) -> list — суммы кусков по k "
     "подряд идущих элементов; последний кусок может быть короче (k >= 1).",
     "def {name}(nums, k):\n"
     "    return [sum(nums[i:i + k]) for i in range(0, len(nums), k)]\n",
     lambda r, i: ([r.randint(-5, 9) for _ in range(i % 8)], 1 + i % 3)),
    ("v2_compress_runs",
     "Напиши функцию {name}(s: str) -> str — сжать подряд идущие одинаковые "
     "символы в «символ + количество»: 'aab' -> 'a2b1'. Пустая строка -> ''.",
     "def {name}(s):\n"
     "    if not s:\n"
     "        return ''\n"
     "    out = []\n"
     "    prev, count = s[0], 1\n"
     "    for ch in s[1:]:\n"
     "        if ch == prev:\n"
     "            count += 1\n"
     "        else:\n"
     "            out.append(prev + str(count))\n"
     "            prev, count = ch, 1\n"
     "    out.append(prev + str(count))\n"
     "    return ''.join(out)\n",
     lambda r, i: ("".join(r.choice("abc") for _ in range(i % 7)),)),
    ("v2_group_lengths",
     "Напиши функцию {name}(words: list) -> dict — словарь «слово -> длина "
     "слова»; повторяющиеся слова дают одно значение.",
     "def {name}(words):\n"
     "    result = {}\n"
     "    for word in words:\n"
     "        result[word] = len(word)\n"
     "    return result\n",
     lambda r, i: ([r.choice(["a", "bb", "ccc", "dd"]) for _ in range(i % 5)],)),
    ("v2_merge_intervals",
     "Напиши функцию {name}(intervals: list) -> list — слить пересекающиеся "
     "и соприкасающиеся отрезки [start, end] (start <= end), результат "
     "отсортирован по началу; пустой список -> [].",
     "def {name}(intervals):\n"
     "    if not intervals:\n"
     "        return []\n"
     "    ordered = sorted(intervals)\n"
     "    merged = [ordered[0][:]]\n"
     "    for start, end in ordered[1:]:\n"
     "        if start <= merged[-1][1]:\n"
     "            merged[-1][1] = max(merged[-1][1], end)\n"
     "        else:\n"
     "            merged.append([start, end])\n"
     "    return merged\n",
     lambda r, i: ([[s, s + r.randint(0, 3)]
                    for s in sorted(r.sample(range(0, 12), 2 + i % 3))],)),
    ("v2_rotate_left",
     "Напиши функцию {name}(nums: list, k: int) -> list — сдвиг влево на k "
     "позиций (k >= 0, k может быть больше длины); пустой список -> [].",
     "def {name}(nums, k):\n"
     "    if not nums:\n"
     "        return []\n"
     "    k = k % len(nums)\n"
     "    return nums[k:] + nums[:k]\n",
     lambda r, i: ([r.randint(0, 9) for _ in range(i % 7)], r.randint(0, 9))),
    ("v2_parse_pairs",
     "Напиши функцию {name}(text: str) -> dict — разобрать строку вида "
     "'a=1, b=2': ключ -> целое; части без '=' или с нечисловым значением "
     "пропускаются, пробелы вокруг ключа и значения срезаются.",
     "def {name}(text):\n"
     "    result = {}\n"
     "    for part in text.split(','):\n"
     "        if '=' not in part:\n"
     "            continue\n"
     "        key, value = part.split('=', 1)\n"
     "        key, value = key.strip(), value.strip()\n"
     "        if not key or not value:\n"
     "            continue\n"
     "        try:\n"
     "            result[key] = int(value)\n"
     "        except ValueError:\n"
     "            continue\n"
     "    return result\n",
     lambda r, i: (", ".join(
         f"{r.choice('abc')}=" + (str(r.randint(0, 9)) if r.random() > 0.2 else "x")
         for _ in range(i % 5 + 1)
     ) + (", broken" if i % 3 == 0 else ""),)),
    ("v2_top_two",
     "Напиши функцию {name}(nums: list) -> list — два самых больших "
     "различных значения по убыванию; если различных значений меньше двух, "
     "вернуть сколько есть.",
     "def {name}(nums):\n"
     "    return sorted(set(nums), reverse=True)[:2]\n",
     lambda r, i: ([r.randint(0, 9) for _ in range(i % 7)],)),
    ("v2_digit_steps",
     "Напиши функцию {name}(n: int) -> int — сколько раз нужно заменить "
     "число суммой его цифр, чтобы получить однозначное число (n >= 0); "
     "для n < 10 — 0.",
     "def {name}(n):\n"
     "    steps = 0\n"
     "    while n >= 10:\n"
     "        total = 0\n"
     "        while n > 0:\n"
     "            total += n % 10\n"
     "            n //= 10\n"
     "        n = total\n"
     "        steps += 1\n"
     "    return steps\n",
     lambda r, i: (r.randint(0, 10 ** (1 + i % 4) - 1),)),
    ("v2_count_pairs",
     "Напиши функцию {name}(nums: list, target: int) -> int — количество пар "
     "разных индексов (i < j), сумма значений которых равна target.",
     "def {name}(nums, target):\n"
     "    seen = {}\n"
     "    count = 0\n"
     "    for x in nums:\n"
     "        count += seen.get(target - x, 0)\n"
     "        seen[x] = seen.get(x, 0) + 1\n"
     "    return count\n",
     lambda r, i: ([r.randint(0, 6) for _ in range(i % 8)], r.randint(0, 10))),
    ("v2_matrix_row_sums",
     "Напиши функцию {name}(matrix: list) -> list — суммы элементов каждой "
     "строки; пустая матрица -> [].",
     "def {name}(matrix):\n"
     "    return [sum(row) for row in matrix]\n",
     lambda r, i: ([[r.randint(-3, 6) for _ in range(i % 4)]
                    for _ in range(i % 4)],)),
    ("v2_longest_run",
     "Напиши функцию {name}(s: str) -> int — длина самой длинной серии "
     "подряд идущих одинаковых символов; пустая строка -> 0.",
     "def {name}(s):\n"
     "    if not s:\n"
     "        return 0\n"
     "    best = current = 1\n"
     "    for i in range(1, len(s)):\n"
     "        if s[i] == s[i - 1]:\n"
     "            current += 1\n"
     "        else:\n"
     "            best = max(best, current)\n"
     "            current = 1\n"
     "    return max(best, current)\n",
     lambda r, i: ("".join(r.choice("ab") for _ in range(i % 8)),)),
]

PER_TEMPLATE = 10


def main() -> int:
    r = random.Random(42)
    rows = []
    for tpl_name, spec_tpl, code_tpl, gen in TEMPLATES:
        for i in range(PER_TEMPLATE):
            name = f"{tpl_name}_v{i}"
            spec = spec_tpl.format(name=name)
            code = code_tpl.replace("{name}", name)
            ns: dict = {}
            exec(code, ns)  # noqa: S102 — шаблон из этого файла
            fn = ns[name]
            cases = [gen(r, i) for _ in range(4)]
            tests = [{"args": list(c), "expected": fn(*c)} for c in cases]
            rows.append({"id": f"tr2{len(rows):03d}", "spec": spec, "name": name,
                         "reference": code, "tests": tests})

    eval_rows = [json.loads(line) for line in EVAL.read_text(encoding="utf-8").splitlines()
                 if line.strip()]
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
    print(f"train tasks v2: {len(rows)} -> {OUT}; пересечений с eval: 0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
