# distill-v2 s2 (#189): downstream pass@1 одного чекпоинта/адаптера на
# holdout-подмножестве eval-30. Нужен для выбора чекпоинта по pass@1, а не по
# eval loss, и для кривой `downstream_pass1` по шагам.
#
# Запуск: python downstream_eval.py --config configs/qlora_v2_rx7600.yaml \
#   --adapter artifacts-v2/checkpoints/checkpoint-10 --out artifacts-v2/downstream/checkpoint-10.json
# Holdout — последние N задач eval-набора (по умолчанию 10), они не входят в
# train-пул (assert в gen_train_tasks_v2.py).

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path

from eval_code import extract_function, make_transformers_gen, run_tests

ROOT = Path(__file__).resolve().parent


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--adapter", required=True)
    ap.add_argument("--tasks", default=str(ROOT / "data" / "tasks.jsonl"))
    ap.add_argument("--holdout", type=int, default=10)
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    tasks = [json.loads(line) for line in Path(args.tasks).read_text(encoding="utf-8").splitlines()
             if line.strip()][-args.holdout:]
    gen = make_transformers_gen(args)
    rows = []
    t_start = time.monotonic()
    for task in tasks:
        t0 = time.monotonic()
        raw = gen(task)
        dt = (time.monotonic() - t0) * 1000
        code = extract_function(raw, task["name"])
        if code is None:
            passed, total, err = 0, len(task["tests"]), "no def extracted"
        else:
            passed, total, err = run_tests(code, task)
        rows.append({"id": task["id"], "passed": passed, "total": total,
                     "ok": passed == total, "error": err,
                     "latency_ms": round(dt)})
        print(f"{task['id']}: {passed}/{total} {dt:.0f}ms", flush=True)
    solved = sum(row["ok"] for row in rows)
    summary = {
        "adapter": args.adapter,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "holdout": len(tasks),
        "pass1": solved,
        "pass1_acc": round(solved / len(tasks), 4) if tasks else None,
        "latency_avg_ms": round(sum(row["latency_ms"] for row in rows) / len(rows)) if rows else None,
        "wall_clock_sec": round(time.monotonic() - t_start, 1),
        "rows": rows,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: summary[k] for k in ("holdout", "pass1", "pass1_acc", "wall_clock_sec")},
                     ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
