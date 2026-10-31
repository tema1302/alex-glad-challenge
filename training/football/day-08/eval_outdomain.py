# День 8 (футбольный трек), s2: цена тюна вне домена.
# Режимы (один рантайм, CPU fp32, temperature=0, seed=42):
#   base  — Qwen2.5-0.5B-Instruct без адаптера, нейтральный system prompt;
#   tuned — тот же рантайм + LoRA-адаптер парсера (day-07).
# Скореры: number — число из ответа == gold; f1 — токен-F1 к референсу
# (порог 0.8); code — извлечённый def исполняется, asserts проходят;
# chat — не отказ и не футбольный поворот.
#
# Запуск: python eval_outdomain.py --adapter ../../day-07/artifacts/adapter \
#           --out ../../../docs/advanced-day-08/football/eval/outdomain

import argparse
import importlib.metadata
import json
import platform
import re
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from common import ROOT, generate, load_jsonl, load_model, token_f1

PACKAGES = ["torch", "transformers", "peft"]
SYSTEM = "Ты полезный ассистент. Отвечай по делу."
REFUSAL = ("не могу", "cannot", "can't", "извините")


def extract_code(raw):
    m = re.search(r"def\s+\w+\s*\(.*", raw, re.S)
    if not m:
        return None
    code = m.group(0)
    # обрезаем хвост после последнего return-блока: берём до конца блока def
    lines = code.split("\n")
    body = [lines[0]]
    for ln in lines[1:]:
        if ln.strip() == "" or ln.startswith((" ", "\t")):
            body.append(ln)
        else:
            break
    return "\n".join(body)


SAFE_BUILTINS = {"len": len, "range": range, "str": str, "int": int,
                 "float": float, "list": list, "sorted": sorted,
                 "min": min, "max": max, "abs": abs, "sum": sum,
                 "isinstance": isinstance, "enumerate": enumerate}


def run_code(code, asserts):
    ns = {"__builtins__": SAFE_BUILTINS}
    try:
        exec(code, ns)  # noqa: S102 — песочница с безопасными builtins
        for stmt in asserts.split(";"):
            stmt = stmt.strip()
            if not stmt:
                continue
            left, right = stmt.split("==")
            val = eval(left.strip(), ns)  # noqa: S307
            expected = eval(right.strip(), ns)  # noqa: S307
            if val != expected:
                return False
        return True
    except Exception:  # noqa: BLE001
        return False


def score(case, raw):
    kind = case["check"]
    if kind == "number":
        nums = re.findall(r"-?\d+(?:[.,]\d+)?", raw.replace(" ", ""))
        norm = case["gold"].replace(",", ".")
        return any(n.replace(",", ".") == norm for n in nums)
    if kind == "f1":
        return token_f1(case["gold"], raw) >= 0.8
    if kind == "code":
        code = extract_code(raw)
        return run_code(code, case["gold"]) if code else False
    low = raw.lower()
    refuses = any(p in low[:120] for p in REFUSAL)
    pivot = ("футбол" in low or "football" in low or "soccer" in low)
    return len(raw.strip()) >= 40 and not refuses and not pivot


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="Qwen/Qwen2.5-0.5B-Instruct")
    ap.add_argument("--adapter", required=True)
    ap.add_argument("--cases", default=str(ROOT / "data" / "outdomain.jsonl"))
    ap.add_argument("--out", required=True)
    ap.add_argument("--max-new-tokens", type=int, default=200)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    import torch
    torch.manual_seed(args.seed)
    cases = load_jsonl(Path(args.cases))
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    model, tokenizer = load_model(args.model)
    from peft import PeftModel
    tuned = PeftModel.from_pretrained(model, args.adapter)

    rows = []
    t0 = time.monotonic()
    for mode in ("base", "tuned"):
        for case in cases:
            messages = [{"role": "system", "content": SYSTEM},
                        {"role": "user", "content": case["prompt"]}]
            t1 = time.monotonic()
            if mode == "base":
                with tuned.disable_adapter():
                    raw = generate(tuned, tokenizer, messages,
                                   args.max_new_tokens)
            else:
                raw = generate(tuned, tokenizer, messages, args.max_new_tokens)
            dt = (time.monotonic() - t1) * 1000
            ok = score(case, raw)
            rows.append({"id": case["id"], "type": case["type"], "mode": mode,
                         "prompt": case["prompt"], "raw": raw, "ok": ok,
                         "latency_ms": round(dt)})
            print(f"[{mode}] {case['id']} ok={ok}", flush=True)

    def agg(mode):
        rs = [r for r in rows if r["mode"] == mode]
        per_type = {}
        for t in ("math", "translate", "code", "chat"):
            sub = [r["ok"] for r in rs if r["type"] == t]
            per_type[t] = round(sum(sub) / len(sub), 3) if sub else None
        return {"avg": round(sum(r["ok"] for r in rs) / len(rs), 3),
                "per_type": per_type,
                "latency_ms_avg": round(statistics.mean(r["latency_ms"] for r in rs))}

    summary = {m: agg(m) for m in ("base", "tuned")}
    env = {
        "model": args.model, "adapter": str(args.adapter),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "seed": args.seed, "platform": platform.platform(),
        "python": sys.version.split()[0],
        "packages": {p: importlib.metadata.version(p) for p in PACKAGES},
        "modes": summary, "wall_s": round(time.monotonic() - t0, 1),
    }
    with open(out_dir / "results.jsonl", "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    (out_dir / "outdomain.json").write_text(
        json.dumps(env, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
