# Скачивает b-mc2/sql-create-context, чистит его и делит на train/val/test
# группами по schema (group split по хэшу context), так что одна schema не
# попадает одновременно в train и test. Стратификация: 1 таблица vs 2+ таблиц.
# Schema фиксированного eval-набора (eval/prompts.jsonl) исключаются полностью —
# eval in-domain остаётся честным held-out.
#
# Выход (data/):
#   raw/sql_create_context_v4.json — скачанный датасет (не в git)
#   train.jsonl / val.jsonl / test.jsonl — {context, question, answer, schema_id}
#   stats.json — факты о данных и сплите (проверяемые, не из головы)
#
# Только stdlib: скрипт можно запускать и локально, и в облаке.

import argparse
import hashlib
import json
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

DATASET_URL = "https://huggingface.co/datasets/b-mc2/sql-create-context/resolve/main/sql_create_context_v4.json"
ROOT = Path(__file__).resolve().parent
RAW_PATH = ROOT / "data" / "raw" / "sql_create_context_v4.json"
EVAL_PROMPTS = ROOT / "eval" / "prompts.jsonl"

DEFAULT_TRAIN = 5000
DEFAULT_VAL = 500
DEFAULT_TEST = 500
SEED_SALT = "day06-sql-lora"


def sha(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"[download] {url} -> {dest}", flush=True)
    with urllib.request.urlopen(url, timeout=300) as r, open(dest, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)


def load_rows(path: Path) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        rows = json.load(f)
    for r in rows:
        r["context"] = r["context"].strip()
        r["question"] = r["question"].strip()
        r["answer"] = r["answer"].strip()
    return rows


def clean(rows: list[dict]) -> tuple[list[dict], dict]:
    """Убирает пустые, точные дубли строк и конфликтующие пары (context, question)."""
    stats = {"raw_rows": len(rows), "empty": 0, "full_dupes": 0, "conflict_rows": 0}

    seen_full = set()
    answers_by_pair = defaultdict(set)
    kept = []
    for r in rows:
        if not r["context"] or not r["question"] or not r["answer"]:
            stats["empty"] += 1
            continue
        full_key = (r["context"], r["question"], r["answer"])
        if full_key in seen_full:
            stats["full_dupes"] += 1
            continue
        seen_full.add(full_key)
        answers_by_pair[(r["context"], r["question"])].add(r["answer"])
        kept.append(r)

    conflict_keys = {k for k, v in answers_by_pair.items() if len(v) > 1}
    before = len(kept)
    kept = [r for r in kept if (r["context"], r["question"]) not in conflict_keys]
    stats["conflict_rows"] = before - len(kept)
    stats["after_clean"] = len(kept)
    return kept, stats


def eval_schema_contexts() -> set[str]:
    """Schema eval-набора: исключаем из всех сплитов целиком (group level)."""
    if not EVAL_PROMPTS.exists():
        return set()
    contexts = set()
    with open(EVAL_PROMPTS, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                contexts.add(json.loads(line)["context"].strip())
    return contexts


def split_group(rows: list[dict], train_n: int, val_n: int, test_n: int):
    """Group split: bucket schema = sha1(salt + schema_id), страты по числу таблиц.

    Квоты train/val/test — потолки: schema, не влезшие в квоту, не попадают
    ни в один сплит (данных хватает с запасом). Счётчики квот ведутся
    отдельно внутри каждой страты, чтобы multi-table гарантированно
    представлялись в val/test пропорционально своей доле.
    """
    by_schema = defaultdict(list)
    for r in rows:
        by_schema[sha(r["context"])].append(r)

    def stratum(schema_rows: list[dict]) -> str:
        n_tables = schema_rows[0]["context"].upper().count("CREATE TABLE")
        return "multi" if n_tables >= 2 else "single"

    strata: dict[str, list[str]] = defaultdict(list)
    counts: dict[str, int] = {}
    for sid, rs in by_schema.items():
        strata[stratum(rs)].append(sid)
        counts[sid] = len(rs)
    total_rows = len(rows)
    targets = {"train": train_n, "val": val_n, "test": test_n}

    split_of: dict[str, str] = {}
    dropped = 0
    for st in sorted(strata):
        st_rows = sum(counts[s] for s in strata[st])
        share = st_rows / total_rows if total_rows else 0
        st_targets = {sp: round(targets[sp] * share) for sp in targets}
        achieved = {sp: 0 for sp in targets}
        for sid in sorted(strata[st]):  # сортировка по хэшу — детерминизм
            for sp in ("test", "val", "train"):  # сначала закрываем маленькие сплиты
                if achieved[sp] < st_targets[sp]:
                    split_of[sid] = sp
                    achieved[sp] += counts[sid]
                    break
            else:
                dropped += 1  # квота train исчерпана — schema остаётся неиспользованной

    out = {"train": [], "val": [], "test": []}
    for sid, sp in split_of.items():
        out[sp].extend(by_schema[sid])
    meta = {
        "schema_total": len(by_schema),
        "schema_used": len(split_of),
        "schema_dropped_quota": dropped,
        "strata": {st: len(sids) for st, sids in strata.items()},
    }
    return out, meta


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps({
                "context": r["context"],
                "question": r["question"],
                "answer": r["answer"],
                "schema_id": sha(r["context"])[:12],
            }, ensure_ascii=False) + "\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--train", type=int, default=DEFAULT_TRAIN)
    ap.add_argument("--val", type=int, default=DEFAULT_VAL)
    ap.add_argument("--test", type=int, default=DEFAULT_TEST)
    args = ap.parse_args()

    if not RAW_PATH.exists():
        download(DATASET_URL, RAW_PATH)
    rows = load_rows(RAW_PATH)
    rows, clean_stats = clean(rows)

    eval_ctx = eval_schema_contexts()
    eval_ctx_hashed = {sha(c) for c in eval_ctx}
    before = len(rows)
    rows = [r for r in rows if sha(r["context"]) not in eval_ctx_hashed]
    excluded_eval_rows = before - len(rows)

    splits, split_meta = split_group(rows, args.train, args.val, args.test)

    stats = {
        **clean_stats,
        "eval_schema_contexts": len(eval_ctx),
        "eval_excluded_rows": excluded_eval_rows,
        **split_meta,
        "split_rows": {sp: len(rs) for sp, rs in splits.items()},
        "target_rows": {"train": args.train, "val": args.val, "test": args.test},
        "seed_salt": SEED_SALT,
    }
    write_jsonl(ROOT / "data" / "train.jsonl", splits["train"])
    write_jsonl(ROOT / "data" / "val.jsonl", splits["val"])
    write_jsonl(ROOT / "data" / "test.jsonl", splits["test"])
    with open(ROOT / "data" / "stats.json", "w", encoding="utf-8") as f:
        json.dump(stats, f, indent=2, ensure_ascii=False)

    print(json.dumps(stats, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
