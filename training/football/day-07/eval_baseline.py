# День 7 (футбольный трек): baseline без тюна на eval-наборе (30 кейсов).
# Два режима базовой Qwen2.5-0.5B-Instruct (CPU fp32, один рантайм):
#   none   — сырой вопрос без инструкций (что модель делает сама);
#   prompt — system prompt (prompts.py) + 3 few-shot из train.
# temperature=0, seed=42. Планка, которую тюн обязан превзойти.
#
# Запуск: python eval_baseline.py --out ../../../docs/advanced-day-07/football/eval

import argparse
import importlib.metadata
import json
import os
import platform
import statistics
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from prompts import SYSTEM_PROMPT

ROOT = Path(__file__).resolve().parent
PACKAGES = ["torch", "transformers", "peft"]


def load_jsonl(p):
    return [json.loads(l) for l in open(p, encoding="utf-8") if l.strip()]


def git_sha():
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                              capture_output=True, text=True, check=True,
                              cwd=ROOT).stdout.strip()
    except Exception:  # noqa: BLE001
        return None


def _scorer_key(x):
    if not isinstance(x, dict):
        return (-1, "", "")
    m = x.get("minute")
    return (m if isinstance(m, int) else -1,
            str(x.get("team")), str(x.get("player")))


def canon(g):
    g = dict(g)
    sc = g.get("scorers")
    if isinstance(sc, list):
        g["scorers"] = sorted(sc, key=_scorer_key)
    return g


def parse_answer(raw):
    """(parse_ok, format_ok, obj|None). format_ok — ровно JSON без прозы."""
    t = raw.strip()
    format_ok = t.startswith("{") and t.endswith("}")
    if not format_ok:
        return False, False, None
    try:
        obj = json.loads(t)
        return isinstance(obj, dict), format_ok, obj
    except json.JSONDecodeError:
        return False, format_ok, None


def score_case(gold_raw, raw):
    gold = canon(json.loads(gold_raw))
    parse_ok, format_ok, obj = parse_answer(raw)
    per_field = {}
    full = False
    if parse_ok:
        obj = canon(obj)
        full = obj == gold
        for k in ("home", "away", "home_score", "away_score", "scorers",
                  "competition", "venue"):
            per_field[k] = obj.get(k) == gold.get(k)
    return {"parse_ok": parse_ok, "format_ok": format_ok, "full_match": full,
            "per_field": per_field}


def pick_few_shots(train_rows, k=3):
    """Детерминированно: результат с голами, ничья 0:0, превью."""
    def find(pred):
        for r in train_rows:
            if pred(r):
                return r
        raise RuntimeError("few-shot не найден")

    result = find(lambda r: r["kind"] == "result"
                  and len(json.loads(r["messages"][1]["content"])["scorers"]) >= 3)
    draw = find(lambda r: r["kind"] == "result"
                and json.loads(r["messages"][1]["content"])["home_score"] == 0)
    preview = find(lambda r: r["kind"] == "preview")
    return [result, draw, preview][:k]


@torch.no_grad()
def generate(model, tokenizer, messages, max_new_tokens):
    ids = tokenizer.apply_chat_template(
        messages, tokenize=True, add_generation_prompt=True, return_tensors="pt")
    out = model.generate(ids, attention_mask=torch.ones_like(ids),
                         max_new_tokens=max_new_tokens, do_sample=False,
                         pad_token_id=tokenizer.pad_token_id)
    return tokenizer.decode(out[0][ids.shape[1]:], skip_special_tokens=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="Qwen/Qwen2.5-0.5B-Instruct")
    ap.add_argument("--eval", default=str(ROOT / "eval" / "eval.jsonl"))
    ap.add_argument("--train", default=str(ROOT / "data" / "train.jsonl"))
    ap.add_argument("--out", required=True)
    ap.add_argument("--max-new-tokens", type=int, default=220)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    torch.set_num_threads(max(1, (os.cpu_count() or 4) - 1))
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    cases = load_jsonl(Path(args.eval))
    train_rows = load_jsonl(Path(args.train))
    few = pick_few_shots(train_rows)

    tokenizer = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForCausalLM.from_pretrained(
        args.model, torch_dtype=torch.float32)
    model.eval()

    results = []
    modes = {"none": [], "prompt": []}
    t0 = time.monotonic()
    for mode in modes:
        for case in cases:
            if mode == "none":
                messages = [{"role": "user", "content": case["prompt"]}]
            else:
                messages = [{"role": "system", "content": SYSTEM_PROMPT}]
                for fs in few:
                    messages.append(fs["messages"][0])
                    messages.append(fs["messages"][1])
                messages.append({"role": "user", "content": case["prompt"]})
            t1 = time.monotonic()
            raw = generate(model, tokenizer, messages, args.max_new_tokens)
            dt = (time.monotonic() - t1) * 1000
            sc = score_case(case["gold"], raw)
            row = {"id": case["id"], "mode": mode, "prompt": case["prompt"],
                   "gold": case["gold"], "raw": raw, "latency_ms": round(dt),
                   **sc}
            results.append(row)
            modes[mode].append(row)
            print(f"[{mode}] {case['id']} parse={sc['parse_ok']} "
                  f"full={sc['full_match']} {dt:.0f}ms", flush=True)

    def summarize(rows):
        n = len(rows)
        agg = {
            "n": n,
            "parse_ok": sum(r["parse_ok"] for r in rows),
            "format_ok": sum(r["format_ok"] for r in rows),
            "full_match": sum(r["full_match"] for r in rows),
            "latency_ms_avg": round(statistics.mean(r["latency_ms"] for r in rows)),
        }
        for k in ("home", "away", "home_score", "away_score", "scorers",
                  "competition", "venue"):
            agg[k] = sum(r["per_field"].get(k, False) for r in rows)
        return agg

    summary = {m: summarize(rows) for m, rows in modes.items()}
    env = {
        "model": args.model, "generated_at": datetime.now(timezone.utc).isoformat(),
        "seed": args.seed, "git_sha": git_sha(),
        "platform": platform.platform(), "python": sys.version.split()[0],
        "cpu": platform.processor(), "cpu_count": os.cpu_count(),
        "device": "cpu", "dtype": "fp32", "do_sample": False,
        "max_new_tokens": args.max_new_tokens,
        "packages": {p: importlib.metadata.version(p) for p in PACKAGES},
        "modes": summary,
        "wall_s": round(time.monotonic() - t0, 1),
    }
    with open(out_dir / "baseline_results.jsonl", "w", encoding="utf-8") as f:
        for r in results:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    (out_dir / "baseline.json").write_text(
        json.dumps(env, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = ["# Baseline без тюна (day-07 football, eval 30 кейсов)", "",
             f"Модель: {args.model}, CPU fp32, temperature=0, seed={args.seed}.",
             "",
             "| Режим | parse_ok | format_ok | full_match | home | away | "
             "home_score | away_score | scorers | competition | venue | latency |",
             "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for m in ("none", "prompt"):
        s = summary[m]
        lines.append(
            f"| {m} | {s['parse_ok']}/{s['n']} | {s['format_ok']}/{s['n']} | "
            f"{s['full_match']}/{s['n']} | {s['home']} | {s['away']} | "
            f"{s['home_score']} | {s['away_score']} | {s['scorers']} | "
            f"{s['competition']} | {s['venue']} | {s['latency_ms_avg']} ms |")
    (out_dir / "baseline_report.md").write_text(
        "\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
