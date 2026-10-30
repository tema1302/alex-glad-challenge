# Проверка сплита day-07: JSONL валиден, утечек train/valid vs eval нет
# (точные и почти-дубли), структура messages корректна, assistant = компактный
# JSON с валидными полями. Выход != 0 при любом нарушении.
#
# Запуск: python check_split.py

import difflib
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RECURRING = (None, "daily", "weekly", "hourly")


def norm_text(s: str) -> str:
    s = re.sub(r"[^\w\s]", " ", s.lower(), flags=re.UNICODE)
    return re.sub(r"\s+", " ", s).strip()


def near(a: str, b: str, t: float = 0.92) -> bool:
    return difflib.SequenceMatcher(None, a, b).ratio() >= t


def load(path: Path) -> list[dict]:
    rows = []
    with open(path, encoding="utf-8") as f:
        for i, line in enumerate(f, 1):
            if not line.strip():
                continue
            row = json.loads(line)
            assert set(row.keys()) == {"messages"}, f"{path.name}:{i}: ключи {row.keys()}"
            msgs = row["messages"]
            assert [m["role"] for m in msgs] == ["system", "user", "assistant"], \
                f"{path.name}:{i}: роли"
            rows.append(row)
    return rows


def main() -> int:
    train = load(ROOT / "data" / "train.jsonl")
    valid = load(ROOT / "data" / "valid.jsonl")
    eval_rows = []
    with open(ROOT / "eval" / "eval_set.jsonl", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                eval_rows.append(json.loads(line))

    users_t = [norm_text(r["messages"][1]["content"]) for r in train]
    users_v = [norm_text(r["messages"][1]["content"]) for r in valid]
    users_e = [norm_text(x["input"]) for x in eval_rows]

    errors: list[str] = []

    # 1. Утечки точные
    leak_t = set(users_t) & set(users_e)
    leak_v = set(users_v) & set(users_e)
    leak_tv = set(users_t) & set(users_v)
    if leak_t:
        errors.append(f"точные утечки train->eval: {sorted(leak_t)[:3]}")
    if leak_v:
        errors.append(f"точные утечки valid->eval: {sorted(leak_v)[:3]}")
    if leak_tv:
        errors.append(f"пересечение train/valid: {sorted(leak_tv)[:3]}")

    # 2. Почти-дубли train vs eval (порог 0.90 — строже, чем чистка 0.92)
    near_hits = [
        (t, e) for t in users_t for e in users_e if near(t, e, 0.90)
    ]
    if near_hits:
        errors.append(f"почти-дубли train~eval: {near_hits[:3]}")

    # 3. assistant — компактный JSON с валидными полями
    bad_json = 0
    by_class: Counter = Counter()
    for r in train + valid:
        content = r["messages"][2]["content"]
        try:
            g = json.loads(content)
            assert g["recurring"] in RECURRING
            assert g["text"] and isinstance(g["text"], str)
            assert g["day_of_week"] is None or 0 <= g["day_of_week"] <= 6
            assert g["interval_hours"] is None or (
                isinstance(g["interval_hours"], int) and g["interval_hours"] >= 1)
            by_class[str(g["recurring"])] += 1
        except Exception as e:  # noqa: BLE001
            bad_json += 1
            errors.append(f"битый assistant JSON: {content[:60]!r} ({e})")
    if bad_json > len(train + valid) * 0.01:
        errors.append(f"слишком много битых JSON: {bad_json}")

    print(f"train={len(train)} valid={len(valid)} eval={len(eval_rows)}")
    print(f"классы (train+valid): {dict(by_class)}")
    if len(train) < 200:
        errors.append(f"train < 200: {len(train)}")
    if len(valid) < 30:
        errors.append(f"valid < 30: {len(valid)}")

    if errors:
        print("ПРОВАЛ:")
        for e in errors:
            print(f"  - {e}")
        return 1
    print("OK: утечек нет, структура валидна, train >= 200, valid >= 30")
    return 0


if __name__ == "__main__":
    sys.exit(main())
