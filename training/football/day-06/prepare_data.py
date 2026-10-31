# День 6 (футбольный трек): подготовка готового HF-датасета
# shehrozrafaqat/global-football-assistant-dataset -> сплиты под Qwen2.5.
#
# Датасет: 9600 ChatML-примеров, порождённых из 323 fact_id. Примеров много,
# а фактов мало -> случайный сплит протекает. Сплит делаем ГРУППОВОЙ по
# fact_id (hash, seed=42): весь факт целиком в одном сплите. eval-набор из 20
# запросов собирается из held-out фактов + ручные OOD, из train/val они
# исключаются целиком.
#
# Только stdlib. Запуск: python prepare_data.py

import hashlib
import json
import random
import re
import statistics
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "data" / "football_chatml_all.jsonl"
SEED = 42
TRAIN_TARGET = 1300          # субсемпл из train-пула (CPU-прогон, ~2 эпохи)
VAL_TARGET = 160
OUT_TRAIN = ROOT / "data" / "train.jsonl"
OUT_VAL = ROOT / "data" / "val.jsonl"
OUT_EVAL = ROOT / "eval" / "prompts.jsonl"
OUT_STATS = ROOT / "data" / "stats.json"

# 20 запросов: 10 in-domain (категории покрывают датасет + Chelsea),
# 5 edge (date-aware safety — gold = каноничный отказ/верификация),
# 5 ood (вне футбола — замер forgetting/локации роли).
EVAL_PLAN_INDOMAIN = [
    ("rules and refereeing", None),
    ("analytics and terminology", None),
    ("tactics and formations", None),
    ("positions and player roles", None),
    ("continental competitions", None),
    ("FIFA and global football", None),
    ("football history and culture", None),
    ("comparison and reasoning", None),
    ("notable clubs", None),
    ("major domestic leagues", "Chelsea"),
]
EVAL_PLAN_EDGE = [("date-aware safety", None)] * 5

OOD_QUESTIONS = [
    "How do I make pancakes from scratch?",
    "Write a Python function that returns the n-th Fibonacci number.",
    "What is 17 multiplied by 24?",
    "Explain the difference between a virus and a bacterium.",
    "Give me three tips for improving sleep quality.",
]


def fact_split_key(fact_id: str) -> float:
    h = hashlib.sha256(f"{SEED}:{fact_id}".encode()).hexdigest()
    return int(h[:12], 16) / 16 ** 12


def norm_prompt(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip().lower())


def main() -> int:
    rng = random.Random(SEED)
    rows = [json.loads(l) for l in open(RAW, encoding="utf-8") if l.strip()]
    assert all(len(r["messages"]) == 2 for r in rows), "ожидаются пары user/assistant"

    # ---------- статистика сырых данных ----------
    prompts = [r["messages"][0]["content"] for r in rows]
    answers = [r["messages"][1]["content"] for r in rows]
    dup_prompts = len(rows) - len({norm_prompt(p) for p in prompts})
    alens = sorted(len(a) for a in answers)
    qlens = sorted(len(p) for p in prompts)
    by_fact = defaultdict(list)
    for r in rows:
        by_fact[r["fact_id"]].append(r)
    cat_of_fact = {fid: rs[0]["category"] for fid, rs in by_fact.items()}
    stats = {
        "source": "shehrozrafaqat/global-football-assistant-dataset",
        "rows": len(rows),
        "fact_ids": len(by_fact),
        "duplicate_user_prompts": dup_prompts,
        "answer_chars": {"avg": round(statistics.mean(alens), 1),
                         "p95": alens[int(0.95 * len(alens))]},
        "question_chars": {"avg": round(statistics.mean(qlens), 1),
                           "p95": qlens[int(0.95 * len(qlens))]},
        "category_counts": dict(Counter(r["category"] for r in rows)),
    }

    # ---------- eval-набор (held-out факты) ----------
    eval_rows: list[dict] = []
    used_facts: set[str] = set()

    def pick(category: str, must_contain: str | None, kind: str) -> None:
        def matches(rs: list[dict]) -> bool:
            if must_contain is None:
                return True
            m = must_contain.lower()
            return any(m in r["messages"][1]["content"].lower()
                       or m in r["messages"][0]["content"].lower() for r in rs)

        cands = [fid for fid, rs in by_fact.items()
                 if cat_of_fact[fid] == category and fid not in used_facts
                 and matches(rs)]
        assert cands, f"нет кандидатов: {category} / {must_contain}"
        fid = sorted(cands)[0]  # детерминированно
        used_facts.add(fid)
        r = sorted(by_fact[fid], key=lambda x: x["messages"][0]["content"])[0]
        eval_rows.append({
            "id": f"d6-{kind}-{len(eval_rows):02d}", "kind": kind,
            "category": category, "fact_id": fid,
            "prompt": r["messages"][0]["content"],
            "gold": r["messages"][1]["content"],
        })

    for cat, must in EVAL_PLAN_INDOMAIN:
        pick(cat, must, "in-domain")
    for cat, must in EVAL_PLAN_EDGE:
        pick(cat, must, "edge")
    for i, q in enumerate(OOD_QUESTIONS):
        eval_rows.append({"id": f"d6-ood-{i:02d}", "kind": "ood",
                          "category": None, "fact_id": None,
                          "prompt": q, "gold": None})

    # ---------- групповой сплит оставшихся фактов ----------
    pool = [fid for fid in by_fact if fid not in used_facts]
    train_facts = [f for f in pool if fact_split_key(f) < 0.9]
    val_facts = [f for f in pool if fact_split_key(f) >= 0.9]
    train_pool = [r for f in train_facts for r in by_fact[f]]
    val_pool = [r for f in val_facts for r in by_fact[f]]
    rng.shuffle(train_pool)
    rng.shuffle(val_pool)
    train_rows = train_pool[:TRAIN_TARGET]
    val_rows = val_pool[:VAL_TARGET]
    assert len(train_rows) == TRAIN_TARGET and len(val_rows) == VAL_TARGET

    # ---------- записи ----------
    for path, part in ((OUT_TRAIN, train_rows), (OUT_VAL, val_rows)):
        with open(path, "w", encoding="utf-8") as f:
            for r in part:
                f.write(json.dumps({
                    "messages": [
                        {"role": "user", "content": r["messages"][0]["content"]},
                        {"role": "assistant", "content": r["messages"][1]["content"]},
                    ],
                    "fact_id": r["fact_id"], "category": r["category"],
                }, ensure_ascii=False) + "\n")
    with open(OUT_EVAL, "w", encoding="utf-8") as f:
        for r in eval_rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    stats.update({
        "seed": SEED,
        "eval": {"total": len(eval_rows),
                 "in-domain": sum(1 for r in eval_rows if r["kind"] == "in-domain"),
                 "edge": sum(1 for r in eval_rows if r["kind"] == "edge"),
                 "ood": sum(1 for r in eval_rows if r["kind"] == "ood"),
                 "held_out_facts": sorted(used_facts)},
        "split": {
            "train": len(train_rows), "val": len(val_rows),
            "train_facts": len(train_facts), "val_facts": len(val_facts),
            "method": "group by fact_id, sha256(seed:fact_id)<0.9 -> train",
        },
        "train_category_counts": dict(Counter(r["category"] for r in train_rows)),
    })
    OUT_STATS.write_text(json.dumps(stats, ensure_ascii=False, indent=2),
                         encoding="utf-8")
    print(json.dumps({k: stats[k] for k in
                      ("rows", "duplicate_user_prompts", "eval", "split")},
                     ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
