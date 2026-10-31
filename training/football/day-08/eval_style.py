# День 8 (футбольный трек), s4: три режима на style-кейсах.
#   base-none   — сырой запрос;
#   base-prompt — system "соблюдай все ограничения формата" (усиление промптом);
#   tuned       — LoRA-адаптер day-07 (перенос JSON-тюна на стиль).
# Rule-скорер из gen_style.py. Один рантайм, temperature=0.
#
# Запуск: python eval_style.py --adapter ../../day-07/artifacts/adapter \
#           --out ../../../docs/advanced-day-08/football/eval/style

import argparse
import importlib.metadata
import json
import platform
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from common import ROOT, generate, load_jsonl, load_model  # noqa: E402
from gen_style import rules_score  # noqa: E402

PACKAGES = ["torch", "transformers", "peft"]
PROMPTED = ("Соблюдай все ограничения формата из запроса: если указаны "
            "обязательные слова, запрещённые слова, лимит длины — выполни их "
            "точно.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="Qwen/Qwen2.5-0.5B-Instruct")
    ap.add_argument("--adapter", required=True)
    ap.add_argument("--cases", default=str(ROOT / "eval" / "style.jsonl"))
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--max-new-tokens", type=int, default=160)
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    cases = load_jsonl(Path(args.cases))
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    model, tokenizer = load_model(args.model)
    from peft import PeftModel
    tuned = PeftModel.from_pretrained(model, args.adapter)

    rows = []
    t0 = time.monotonic()
    for mode in ("base-none", "base-prompt", "tuned"):
        for case in cases:
            messages = []
            if mode == "base-prompt":
                messages.append({"role": "system", "content": PROMPTED})
            messages.append({"role": "user", "content": case["prompt"]})
            t1 = time.monotonic()
            if mode == "tuned":
                raw = generate(tuned, tokenizer, messages, args.max_new_tokens)
            else:
                with tuned.disable_adapter():
                    raw = generate(tuned, tokenizer, messages,
                                   args.max_new_tokens)
            dt = (time.monotonic() - t1) * 1000
            ok = rules_score(case["rules"], raw)
            rows.append({"id": case["id"], "style": case["style"],
                         "mode": mode, "prompt": case["prompt"], "raw": raw,
                         "ok": ok, "latency_ms": round(dt)})
            print(f"[{mode}] {case['id']} ok={ok}", flush=True)

    def agg(mode):
        rs = [r for r in rows if r["mode"] == mode]
        return {"avg": round(sum(r["ok"] for r in rs) / len(rs), 3),
                "n": len(rs),
                "latency_ms_avg": round(statistics.mean(r["latency_ms"] for r in rs))}

    summary = {m: agg(m) for m in ("base-none", "base-prompt", "tuned")}
    env = {
        "model": args.model, "adapter": str(args.adapter),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "seed": args.seed, "platform": platform.platform(),
        "python": sys.version.split()[0],
        "packages": {p: importlib.metadata.version(p) for p in PACKAGES},
        "modes": summary, "wall_s": round(time.monotonic() - t0, 1),
    }
    with open(out_dir / "style_results.jsonl", "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    (out_dir / "style.json").write_text(
        json.dumps(env, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
