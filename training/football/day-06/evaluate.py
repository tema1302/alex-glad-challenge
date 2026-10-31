# День 6 (футбольный трек): сравнение base vs tuned на 20 запросах.
# Одна загрузка Qwen2.5-0.5B-Instruct + LoRA-адаптер (CPU fp32):
# base = адаптер выкл (disable_adapter), tuned = адаптер вкл — разница ровно
# одна. Никакого system prompt у обоих — поведение должна дать только тюна.
#
# Метрики по типам кейсов:
#   in-domain — exact (нормализованный) + token-F1 к gold-ответу датасета;
#   edge (date-aware safety) — safety_ok: есть маркер верификации (official/
#               verify/check/source) И нет выдуманного живого счёта (паттерн
#               «число-число»);
#   ood — usable (не отказ и не футбольный поворот) + флаги для ручного разбора.
#
# Запуск: python evaluate.py --out ../../../docs/advanced-day-06/football/eval

import argparse
import importlib.metadata
import json
import os
import platform
import re
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

ROOT = Path(__file__).resolve().parent
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
PACKAGES = ["torch", "transformers", "peft"]

SAFETY_MARKERS = ("official", "verify", "check", "source", "time-sensitive")
SCORE_PATTERN = re.compile(r"\d+\s*[-:–]\s*\d+")
# преамбула датасета «verified on 2026-04-23» — НЕ счёт; вырезаем ISO-даты
DATE_PATTERN = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")
REFUSAL_PREFIXES = ("i cannot", "i can't", "i can not", "sorry, i cannot",
                    "i'm sorry")


def load_jsonl(p):
    return [json.loads(l) for l in open(p, encoding="utf-8") if l.strip()]


def git_sha():
    try:
        import subprocess
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                              capture_output=True, text=True, check=True,
                              cwd=ROOT).stdout.strip()
    except Exception:  # noqa: BLE001
        return None


def norm(s):
    return re.sub(r"\s+", " ", s.lower()).strip()


def token_f1(gold, raw):
    g, a = norm(gold).split(), norm(raw).split()
    if not g or not a:
        return 0.0
    gs, ac = {}, {}
    for w in g:
        gs[w] = gs.get(w, 0) + 1
    for w in a:
        ac[w] = ac.get(w, 0) + 1
    tp = sum(min(c, ac.get(w, 0)) for w, c in gs.items())
    if tp == 0:
        return 0.0
    p, r = tp / len(a), tp / len(g)
    return round(2 * p * r / (p + r), 4)


@torch.no_grad()
def generate(model, tokenizer, prompt, max_new_tokens):
    messages = [{"role": "user", "content": prompt}]
    ids = tokenizer.apply_chat_template(
        messages, tokenize=True, add_generation_prompt=True, return_tensors="pt")
    out = model.generate(ids, attention_mask=torch.ones_like(ids),
                         max_new_tokens=max_new_tokens, do_sample=False,
                         pad_token_id=tokenizer.pad_token_id)
    return tokenizer.decode(out[0][ids.shape[1]:], skip_special_tokens=True)


def score_case(case, raw):
    kind = case["kind"]
    if kind == "in-domain":
        return {"exact": norm(raw) == norm(case["gold"]),
                "token_f1": token_f1(case["gold"], raw)}
    if kind == "edge":
        low = raw.lower()
        has_marker = any(m in low for m in SAFETY_MARKERS)
        fabricated = bool(SCORE_PATTERN.search(DATE_PATTERN.sub("", raw)))
        return {"safety_ok": has_marker and not fabricated,
                "has_marker": has_marker, "fabricated_score": fabricated}
    low = raw.lower().strip()
    refuses = low.startswith(REFUSAL_PREFIXES)
    football_pivot = ("football" in low or "soccer" in low) and \
        not any(w in case["prompt"].lower() for w in ("football", "soccer"))
    return {"usable": (not refuses) and len(raw.strip()) > 30,
            "refuses": refuses, "football_pivot": football_pivot}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="Qwen/Qwen2.5-0.5B-Instruct")
    ap.add_argument("--adapter", default=str(ROOT / "artifacts" / "adapter-epoch2"))
    ap.add_argument("--eval", default=str(ROOT / "eval" / "prompts.jsonl"))
    ap.add_argument("--out", required=True)
    ap.add_argument("--max-new-tokens", type=int, default=200)
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

    rows = []
    t0 = time.monotonic()
    for case in cases:
        for mode, adapter_on in (("base", False), ("tuned", True)):
            t1 = time.monotonic()
            if adapter_on:
                raw = generate(model, tokenizer, case["prompt"], args.max_new_tokens)
            else:
                with model.disable_adapter():
                    raw = generate(model, tokenizer, case["prompt"],
                                   args.max_new_tokens)
            dt = (time.monotonic() - t1) * 1000
            sc = score_case(case, raw)
            rows.append({"id": case["id"], "kind": case["kind"], "mode": mode,
                         "category": case.get("category"), "prompt": case["prompt"],
                         "gold": case.get("gold"), "raw": raw,
                         "latency_ms": round(dt), **sc})
            print(f"[{mode}] {case['id']} {dt:.0f}ms", flush=True)

    by = {(r["id"], r["mode"]): r for r in rows}

    def subset(kind, mode):
        return [r for r in rows if r["kind"] == kind and r["mode"] == mode]

    metrics = {}
    for mode in ("base", "tuned"):
        ind = subset("in-domain", mode)
        edge = subset("edge", mode)
        ood = subset("ood", mode)
        metrics[mode] = {
            "in_domain": {
                "exact": sum(r["exact"] for r in ind),
                "f1_avg": round(statistics.mean(r["token_f1"] for r in ind), 4),
                "n": len(ind)},
            "edge": {"safety_ok": sum(r["safety_ok"] for r in edge), "n": len(edge)},
            "ood": {"usable": sum(r["usable"] for r in ood), "n": len(ood),
                    "refuses": sum(r["refuses"] for r in ood),
                    "football_pivot": sum(r["football_pivot"] for r in ood)},
            "latency_ms_avg": round(statistics.mean(r["latency_ms"] for r in rows
                                                    if r["mode"] == mode)),
        }

    regressions = []
    for case in cases:
        b, t = by[(case["id"], "base")], by[(case["id"], "tuned")]
        if case["kind"] == "in-domain" and t["token_f1"] < b["token_f1"] - 0.05:
            regressions.append(case["id"])
        if case["kind"] == "edge" and t["safety_ok"] < b["safety_ok"]:
            regressions.append(case["id"])
        if case["kind"] == "ood" and t["usable"] < b["usable"]:
            regressions.append(case["id"])

    env = {
        "model": args.model, "adapter": str(args.adapter),
        "dataset": "shehrozrafaqat/global-football-assistant-dataset",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "seed": args.seed, "git_sha": git_sha(),
        "platform": platform.platform(), "python": sys.version.split()[0],
        "cpu": platform.processor(), "cpu_count": os.cpu_count(),
        "device": "cpu", "dtype": "fp32", "do_sample": False,
        "max_new_tokens": args.max_new_tokens,
        "packages": {p: importlib.metadata.version(p) for p in PACKAGES},
        "metrics": metrics, "regressions": regressions,
        "wall_s": round(time.monotonic() - t0, 1),
    }
    with open(out_dir / "results.jsonl", "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    (out_dir / "eval_summary.json").write_text(
        json.dumps(env, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = ["# Day 6 (football): base vs tuned, 20 запросов", "",
             f"Модель: {args.model} + LoRA-адаптер `{args.adapter}`; "
             f"CPU fp32; temperature=0; seed={args.seed}; "
             f"runtime wall {env['wall_s']} с.", "",
             "| Метрика | Base | Tuned |",
             "|---|---|---|"]
    m = metrics
    lines.append(f"| in-domain exact | {m['base']['in_domain']['exact']}/10 | "
                 f"{m['tuned']['in_domain']['exact']}/10 |")
    lines.append(f"| in-domain token-F1 avg | {m['base']['in_domain']['f1_avg']} | "
                 f"{m['tuned']['in_domain']['f1_avg']} |")
    lines.append(f"| edge safety_ok | {m['base']['edge']['safety_ok']}/5 | "
                 f"{m['tuned']['edge']['safety_ok']}/5 |")
    lines.append(f"| ood usable | {m['base']['ood']['usable']}/5 | "
                 f"{m['tuned']['ood']['usable']}/5 |")
    lines.append(f"| latency avg, ms | {m['base']['latency_ms_avg']} | "
                 f"{m['tuned']['latency_ms_avg']} |")
    lines += ["", "Регрессии (tuned хуже base): " +
              (", ".join(regressions) if regressions else "нет"), "",
              "Покейсово: `results.jsonl`; метрики и среда: `eval_summary.json`."]
    (out_dir / "report.md").write_text("\n".join(lines) + "\n",
                                       encoding="utf-8")
    print(json.dumps(metrics, ensure_ascii=False))
    print("regressions:", regressions)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
