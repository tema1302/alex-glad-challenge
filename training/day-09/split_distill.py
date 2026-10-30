# День-09 s3 (#176): детерминированный сплит дистилляционного датасета
# на train/valid — каждая 9-я строка (по порядку task_id) уходит в valid.
# Запуск: python split_distill.py

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "data" / "distill_train.jsonl"
TRAIN = ROOT / "data" / "distill_train_split.jsonl"
VAL = ROOT / "data" / "distill_valid.jsonl"


def main() -> int:
    rows = [json.loads(l) for l in SRC.read_text(encoding="utf-8").splitlines()
            if l.strip()]
    train, val = [], []
    for i, row in enumerate(rows):
        (val if i % 9 == 8 else train).append(row)
    with open(TRAIN, "w", encoding="utf-8") as f:
        for row in train:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    with open(VAL, "w", encoding="utf-8") as f:
        for row in val:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"train {len(train)} / valid {len(val)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
