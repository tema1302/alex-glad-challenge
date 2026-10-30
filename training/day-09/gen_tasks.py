# День-09 s1 (#169): набор задач «спецификация → Python-функция».
# Gold по построению: reference-реализация; тесты = фиксированные входы,
# ожидания считаются исполнением reference (self-check в gen).
#
# Выход: data/tasks.jsonl — {"id", "spec", "name", "reference", "tests":
#   [{"args": [...], "kwargs": {...}, "expected": <eval>}]}
# Запуск: python gen_tasks.py

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "data" / "tasks.jsonl"


def t(spec, name, reference, cases):
    return {"spec": spec, "name": name, "reference": reference,
            "cases": cases}


TASKS = [
    t("Напиши функцию reverse_string(s: str) -> str, переворачивающую строку.",
      "reverse_string", "def reverse_string(s):\n    return s[::-1]\n",
      [("hello",), ("",), ("abc def",), ("я",)]),
    t("Напиши функцию count_vowels(s: str) -> int — число гласных "
      "(аеёиоуыэюяaeiouy, без учёта регистра).",
      "count_vowels",
      "def count_vowels(s):\n    v = 'аеёиоуыэюяaeiouy'\n"
      "    return sum(1 for ch in s.lower() if ch in v)\n",
      [("hello",), ("Абракадабра",), ("bcdfg",), ("",)]),
    t("Напиши функцию is_prime(n: int) -> bool — простое ли число.",
      "is_prime",
      "def is_prime(n):\n    if n < 2:\n        return False\n"
      "    for i in range(2, int(n ** 0.5) + 1):\n"
      "        if n % i == 0:\n            return False\n"
      "    return True\n",
      [(7,), (1,), (2,), (91,)]),
    t("Напиши функцию flatten(items: list) -> list — расплющить список на "
      "один уровень: [[1, 2], [3], []] → [1, 2, 3].",
      "flatten",
      "def flatten(items):\n    out = []\n    for it in items:\n"
      "        out.extend(it)\n    return out\n",
      [([[1, 2], [3], []],), ([[], []],), ([[0]],), ([['a'], ['b', 'c']],)]),
    t("Напиши функцию word_count(text: str) -> int — число слов (слова "
      "разделены пробелами).",
      "word_count",
      "def word_count(text):\n    return len(text.split())\n",
      [("hello world",), ("",), ("  a  b  ",), ("one",)]),
    t("Напиши функцию fib(n: int) -> int — n-е число Фибоначчи "
      "(fib(0)=0, fib(1)=1).",
      "fib",
      "def fib(n):\n    a, b = 0, 1\n    for _ in range(n):\n"
      "        a, b = b, a + b\n    return a\n",
      [(0,), (1,), (10,), (15,)]),
    t("Напиши функцию is_palindrome(s: str) -> bool — палиндром ли строка "
      "(без учёта регистра и пробелов).",
      "is_palindrome",
      "def is_palindrome(s):\n    s = s.lower().replace(' ', '')\n"
      "    return s == s[::-1]\n",
      [("А роза упала на лапу Азора",), ("hello",), ("",), ("12321",)]),
    t("Напиши функцию max_diff(nums: list) -> int — максимальная разница "
      "между любыми двумя элементами. Список непустой.",
      "max_diff",
      "def max_diff(nums):\n    return max(nums) - min(nums)\n",
      [([1, 9, 2],), ([5, 5],), ([-3, 7],), ([0, 100, 1],)]),
    t("Напиши функцию merge_dicts(a: dict, b: dict) -> dict — слияние: "
      "значения b перекрывают a.",
      "merge_dicts",
      "def merge_dicts(a, b):\n    out = dict(a)\n    out.update(b)\n"
      "    return out\n",
      [({"x": 1}, {"y": 2}), ({"x": 1}, {"x": 2}), ({}, {"a": 0}),
       ({"a": 1, "b": 2}, {})]),
    t("Напиши функцию unique_order(items: list) -> list — уникальные "
      "элементы в порядке первого появления.",
      "unique_order",
      "def unique_order(items):\n    seen = []\n    for it in items:\n"
      "        if it not in seen:\n            seen.append(it)\n"
      "    return seen\n",
      [([1, 2, 1, 3, 2],), ([],), ([7, 7, 7],), (["a", "b", "a"],)]),
    t("Напиши функцию digits_sum(n: int) -> int — сумма цифр числа "
      "(по модулю).",
      "digits_sum",
      "def digits_sum(n):\n    return sum(int(d) for d in str(abs(n)))\n",
      [(123,), (-45,), (0,), (999,)]),
    t("Напиши функцию caesar(s: str, k: int) -> str — шифр Цезаря для "
      "латиницы (сохранять регистр, прочие символы как есть).",
      "caesar",
      "def caesar(s, k):\n    out = []\n    for ch in s:\n"
      "        if 'a' <= ch <= 'z':\n"
      "            out.append(chr((ord(ch) - 97 + k) % 26 + 97))\n"
      "        elif 'A' <= ch <= 'Z':\n"
      "            out.append(chr((ord(ch) - 65 + k) % 26 + 65))\n"
      "        else:\n            out.append(ch)\n"
      "    return ''.join(out)\n",
      [("abc", 1), ("XYZ", 2), ("a b!", 3), ("z", 1)]),
    t("Напиши функцию second_largest(nums: list) -> int — второй по "
      "величине элемент (уникальные значения, список из ≥2 уникальных).",
      "second_largest",
      "def second_largest(nums):\n    return sorted(set(nums))[-2]\n",
      [([1, 5, 3],), ([10, 9],), ([1, 2, 3, 4],), ([-1, -2, -3],)]),
    t("Напиши функцию gcd(a: int, b: int) -> int — наибольший общий "
      "делитель (через вычитание или Евклида).",
      "gcd", "def gcd(a, b):\n    while b:\n        a, b = b, a % b\n"
      "    return abs(a)\n",
      [(12, 18), (7, 13), (100, 10), (0, 5)]),
    t("Напиши функцию strip_vowels(s: str) -> str — удалить все гласные "
      "(aeiouy, латиница, оба регистра).",
      "strip_vowels",
      "def strip_vowels(s):\n    return ''.join(ch for ch in s\n"
      "        if ch.lower() not in 'aeiouy')\n",
      [("hello world",), ("AEIOU",), ("bcdfg",), ("",)]),
    t("Напиши функцию title_words(s: str) -> str — каждое слово с "
      "большой буквы (str.title).",
      "title_words",
      "def title_words(s):\n    return s.title()\n",
      [("hello world",), ("a b",), ("",), ("UPPER lower",)]),
    t("Напиши функцию running_sum(nums: list) -> list — префиксные суммы.",
      "running_sum",
      "def running_sum(nums):\n    out, acc = [], 0\n"
      "    for n in nums:\n        acc += n\n        out.append(acc)\n"
      "    return out\n",
      [([1, 2, 3],), ([],), ([5],), ([-1, 1, -1],)]),
    t("Напиши функцию common(a: list, b: list) -> list — пересечение "
      "без дубликатов, порядок как в a.",
      "common",
      "def common(a, b):\n    return [x for x in dict.fromkeys(a)\n"
      "        if x in b]\n",
      [([1, 2, 3], [2, 3, 4]), ([], [1]), ([1, 1, 2], [1]), (["a"], ["b"])]),
    t("Напиши функцию char_freq(s: str) -> dict — частоты символов.",
      "char_freq",
      "def char_freq(s):\n    out = {}\n    for ch in s:\n"
      "        out[ch] = out.get(ch, 0) + 1\n    return out\n",
      [("aab",), ("",), ("xyz",), ("аааб",)]),
    t("Напиши функцию clamp(x: int, lo: int, hi: int) -> int — ограничить "
      "x диапазоном [lo, hi].",
      "clamp",
      "def clamp(x, lo, hi):\n    return max(lo, min(hi, x))\n",
      [(5, 0, 10), (-1, 0, 10), (11, 0, 10), (3, 3, 3)]),
    # --- сложнее: сюда base-1.5b ожидаемо чаще промахивается ---
    t("Напиши функцию is_anagram(a: str, b: str) -> bool — анаграммы ли "
      "(без учёта регистра и небукв).",
      "is_anagram",
      "def is_anagram(a, b):\n    ka = sorted(ch.lower() for ch in a\n"
      "        if ch.isalpha())\n"
      "    kb = sorted(ch.lower() for ch in b\n"
      "        if ch.isalpha())\n    return ka == kb\n",
      [("listen", "silent"), ("Hello", "Olelh"), ("abc", "abd"),
       ("Dormitory", "Dirty room")]),
    t("Напиши функцию longest_word(s: str) -> str — самое длинное слово; "
      "при равенстве — первое. Слова разделены пробелами, строка непустая.",
      "longest_word",
      "def longest_word(s):\n    words = s.split()\n    best = words[0]\n"
      "    for w in words[1:]:\n        if len(w) > len(best):\n"
      "            best = w\n    return best\n",
      [("a bb cc",), ("one three two",), ("abc de fgh",), ("x y z",)]),
    t("Напиши функцию snake_case(s: str) -> str — 'Hello World!' → "
      "'hello_world': буквы/цифры в нижний регистр, пробелы и знаки "
      "препинания — в '_', подряд идущие '_' слить, края подрезать.",
      "snake_case",
      "def snake_case(s):\n    out = []\n    for ch in s:\n"
      "        if ch.isalnum():\n            out.append(ch.lower())\n"
      "        else:\n            out.append('_')\n"
      "    return ''.join(out).strip('_').replace('__', '_')\n",
      [("Hello World!",), ("already_snake",), ("A  B",), ("x",)]),
    t("Напиши функцию brackets_balanced(s: str) -> bool — сбалансированы "
      "ли скобки () [] {}.",
      "brackets_balanced",
      "def brackets_balanced(s):\n    pairs = {')': '(', ']': '[', "
      "'}': '{'}\n    stack = []\n    for ch in s:\n"
      "        if ch in '([{':\n            stack.append(ch)\n"
      "        elif ch in ')]}':\n"
      "            if not stack or stack.pop() != pairs[ch]:\n"
      "                return False\n    return not stack\n",
      [("()",), ("([{}])",), ("(]",), ("((",)]),
    t("Напиши функцию missing_number(nums: list) -> int — в списке числа "
      "0..n вперемешку без одного; верни недостающее.",
      "missing_number",
      "def missing_number(nums):\n    n = len(nums)\n"
      "    return n * (n + 1) // 2 - sum(nums)\n",
      [([0, 1, 3],), ([1],), ([0, 2, 1, 4],), ([0],)]),
    t("Напиши функцию two_sum(nums: list, target: int) -> bool — есть ли "
      "два разных элемента, дающие target в сумме.",
      "two_sum",
      "def two_sum(nums, target):\n    seen = set()\n    for x in nums:\n"
      "        if target - x in seen:\n            return True\n"
      "        seen.add(x)\n    return False\n",
      [([2, 7, 11], 9), ([1, 2], 4), ([0, 0], 0), ([5], 10)]),
    t("Напиши функцию rotate(nums: list, k: int) -> list — циклический "
      "сдвиг вправо на k позиций (k >= 0).",
      "rotate",
      "def rotate(nums, k):\n    if not nums:\n        return []\n"
      "    k = k % len(nums)\n    return nums[-k:] + nums[:-k] if k "
      "else list(nums)\n",
      [([1, 2, 3, 4], 1), ([1, 2, 3], 4), ([], 2), ([7, 8], 2)]),
    t("Напиши функцию count_inversions(nums: list) -> int — число пар "
      "(i, j), i < j, nums[i] > nums[j].",
      "count_inversions",
      "def count_inversions(nums):\n    cnt = 0\n"
      "    for i in range(len(nums)):\n"
      "        for j in range(i + 1, len(nums)):\n"
      "            if nums[i] > nums[j]:\n                cnt += 1\n"
      "    return cnt\n",
      [([1, 2, 3],), ([3, 2, 1],), ([],), ([2, 1, 4, 3],)]),
    t("Напиши функцию digit_root(n: int) -> int — цифровой корень: сумма "
      "цифр, пока не останется одна цифра (n >= 0).",
      "digit_root",
      "def digit_root(n):\n    while n >= 10:\n"
      "        n = sum(int(d) for d in str(n))\n    return n\n",
      [(38,), (9,), (0,), (12345,)]),
    t("Напиши функцию vowel_start_words(text: str) -> list — слова, "
      "начинающиеся с гласной (aeiouy, любой регистр), в исходном порядке.",
      "vowel_start_words",
      "def vowel_start_words(text):\n    return [w for w in text.split()\n"
      "        if w and w[0].lower() in 'aeiouy']\n",
      [("apple dog egg",), ("sky fly",), ("ONE two",), ("",)]),
]


def main() -> int:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    for i, task in enumerate(TASKS):
        ns: dict = {}
        exec(task["reference"], ns)  # noqa: S102 — референс из этого файла
        fn = ns[task["name"]]
        tests = []
        for case in task["cases"]:
            args = list(case)
            expected = fn(*args)
            tests.append({"args": args, "expected": expected})
        rows.append({
            "id": f"t{i:02d}", "spec": task["spec"], "name": task["name"],
            "reference": task["reference"], "tests": tests,
        })
    with open(OUT, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"tasks: {len(rows)} -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
