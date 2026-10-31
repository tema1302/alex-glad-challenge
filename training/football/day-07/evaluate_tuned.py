# День 7 (футбольный трек): сравнение tuned vs base-prompt в ОДНОМ рантайме.
# Одна загрузка Qwen2.5-0.5B-Instruct + LoRA-адаптер; tuned = адаптер вкл,
# base-prompt = адаптер выкл (model.disable_adapter()) — разница ровно одна.
# temperature=0, seed=42. Регрессии: кейсы, где tuned хуже base-prompt.
#
# Запуск: python evaluate_tuned.py --out ../../../docs/advanced-day-07/football/eval

import argparse
import importlib.metadata
import json
import os
import platform
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from eval_baseline import generate, git_sha, load_jsonl, score_case
from prompts import SYSTEM_PROMPT

ROOT = Path(__file__).resolve().parent
PACKAGES = ["torch", "transformers", "peft"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="Qwen/Qwen2.5-0.5B-Instruct")
    ap.add_argument("--adapter", default=str(ROOT / "artifacts" / "adapter"))
    ap.add_argument("--eval", default=str(ROOT / "eval" / "eval.jsonl"))
    ap.add_argument("--out", required=True)
    ap.add_argument("--max-new-tokens", type=int, default=220)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    torch.set_num_threads(max(1, (os.cpu_count() or 4) - 1))
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    cases = load_jsonl(Path(args.eval))
    tokenizer = AutoTokenizer.from_pretrained(args.model)
    base = AutoModelForCausalLM.from_pretrained(args.model, torch_dtype=torch.float32)
    model = PeftModel.from_pretrained(base, args.adapter)
    model.eval()

    modes = {"tuned": True, "base-prompt": False}
    results = {m: [] for m in modes}
    rows = []
    t0 = time.monotonic()
    for mode, adapter_on in modes.items():
        for case in cases:
            messages = [{"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": case["prompt"]}]
            t1 = time.monotonic()
            if adapter_on:
                raw = generate(model, tokenizer, messages, args.max_new_tokens)
            else:
                with model.disable_adapter():
                    raw = generate(model, tokenizer, messages, args.max_new_tokens)
            dt = (time.monotonic() - t1) * 1000
            sc = score_case(case["gold"], raw)
            row = {"id": case["id"], "mode": mode, "prompt": case["prompt"],
                   "gold": case["gold"], "raw": raw, "latency_ms": round(dt),
                   **sc}
            rows.append(row)
            results[mode].append(row)
            print(f"[{mode}] {case['id']} parse={sc['parse_ok']} "
                  f"full={sc['full_match']} {dt:.0f}ms", flush=True)

    def summarize(rs):
        n = len(rs)
        agg = {"n": n,
               "parse_ok": sum(r["parse_ok"] for r in rs),
               "format_ok": sum(r["format_ok"] for r in rs),
               "full_match": sum(r["full_match"] for r in rs),
               "latency_ms_avg": round(statistics.mean(r["latency_ms"] for r in rs))}
        for k in ("home", "away", "home_score", "away_score", "scorers",
                  "competition", "venue"):
            agg[k] = sum(r["per_field"].get(k, False) for r in rs)
        return agg

    summary = {m: summarize(rs) for m, rs in results.items()}
    by_id = {}
    for r in rows:
        by_id.setdefault(r["id"], {})[r["mode"]] = r
    regressions = [i for i, pair in by_id.items()
                   if pair["tuned"]["full_match"] < pair["base-prompt"]["full_match"]]

    env = {
        "model": args.model, "adapter": str(args.adapter),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "seed": args.seed, "git_sha": git_sha(),
        "platform": platform.platform(), "python": sys.version.split()[0],
        "cpu": platform.processor(), "cpu_count": os.cpu_count(),
        "device": "cpu", "dtype": "fp32", "do_sample": False,
        "max_new_tokens": args.max_new_tokens,
        "packages": {p: importlib.metadata.version(p) for p in PACKAGES},
        "modes": summary, "regressions": sorted(regressions),
        "wall_s": round(time.monotonic() - t0, 1),
    }
    with open(out_dir / "tuned_results.jsonl", "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    (out_dir / "tuned.json").write_text(
        json.dumps(env, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = ["# Tuned vs base-prompt (day-07 football, один рантайм)", "",
             f"Модель: {args.model} + LoRA-адаптер `{args.adapter}`, "
             f"CPU fp32, temperature=0, seed={args.seed}.", "",
             "| Режим | parse_ok | format_ok | full_match | home | away | "
             "home_score | away_score | scorers | competition | venue | latency |",
             "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for m in ("tuned", "base-prompt"):
        s = summary[m]
        lines.append(
            f"| {m} | {s['parse_ok']}/{s['n']} | {s['format_ok']}/{s['n']} | "
            f"{s['full_match']}/{s['n']} | {s['home']} | {s['away']} | "
            f"{s['home_score']} | {s['away_score']} | {s['scorers']} | "
            f"{s['competition']} | {s['venue']} | {s['latency_ms_avg']} ms |")
    if regressions:
        lines += ["", "## Регрессии tuned относительно base-prompt", ""]
        for i in regressions:
            pair = by_id[i]
            lines += [f"### {i}", "",
                      f"- prompt: {pair['tuned']['prompt'][:120]}",
                      f"- gold: `{pair['tuned']['gold']}`",
                      f"- base-prompt: `{pair['base-prompt']['raw'][:220]}`",
                      f"- tuned: `{pair['tuned']['raw'][:220]}`", ""]
    (out_dir / "tuned_report.md").write_text(
        "\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))
    print("regressions:", regressions)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
