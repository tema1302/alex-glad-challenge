import json
import random
import sys

rows = [json.loads(l) for l in open("data/train.jsonl", encoding="utf-8") if l.strip()]
random.seed(int(sys.argv[1]) if len(sys.argv) > 1 else 11)
sample = random.sample(rows, 30)
for r in sample:
    print(f"- {r['messages'][1]['content']!r} -> {r['messages'][2]['content']}")
