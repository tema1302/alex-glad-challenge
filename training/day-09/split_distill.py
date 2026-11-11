# День-09 s3 (#176): детерминированный сплит дистилляционного датасета
# на train/valid — каждая 9-я строка (по порядку task_id) уходит в valid.
# distill-v2 s2 (#189): пути задаются флагами, чтобы не перезаписывать v1.
# Запуск: python split_distill.py [--src data/distill_train_v2.jsonl \
#   --train data/distill_train_v2_split.jsonl --val data/distill_valid_v2.jsonl]

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(ROOT / "data" / "distill_train.jsonl"))
    ap.add_argument("--train", default=str(ROOT / "data" / "distill_train_split.jsonl"))
    ap.add_argument("--val", default=str(ROOT / "data" / "distill_valid.jsonl"))
    args = ap.parse_args()

    src, train_path, val_path = Path(args.src), Path(args.train), Path(args.val)
    rows = [json.loads(line) for line in src.read_text(encoding="utf-8").splitlines()
            if line.strip()]
    train, val = [], []
    for i, row in enumerate(rows):
        (val if i % 9 == 8 else train).append(row)
    with open(train_path, "w", encoding="utf-8") as f:
        for row in train:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    with open(val_path, "w", encoding="utf-8") as f:
        for row in val:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"train {len(train)} / valid {len(val)} -> {train_path}, {val_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
