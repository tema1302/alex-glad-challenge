# День 7 (футбольный трек): печать 30 случайных примеров train для
# глазного ревью (требование чек-листа дня). Запуск: python sample_review.py

import json
import random
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent


def main():
    rows = [json.loads(l) for l in open(ROOT / "data" / "train.jsonl",
                                        encoding="utf-8")]
    rng = random.Random(7)
    for i, r in enumerate(rng.sample(rows, 30), 1):
        print(f"--- #{i} [{r['kind']}] ---")
        print("U:", r["messages"][0]["content"])
        print("A:", r["messages"][1]["content"])
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
