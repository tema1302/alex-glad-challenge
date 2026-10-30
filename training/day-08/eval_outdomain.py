# День-08 s2 (#165): потери вне домена — замер base vs tuned на задачах
# вне todo (chat / math / translate / code). Два бэкенда:
#   --backend ollama        (локально, base-only): режимы base-none / base-prompt;
#   --backend transformers  (Kaggle T4): tuned (adapter вкл) vs base (выкл),
#                           одна 4-bit загрузка, стек day-07.
# temperature=0, seed=42. Метрика покейсово: exact (нормализованное
# совпадение) или f1 (перевод). Отчёт по категориям: outdomain_report.md,
# outdomain.json, results_<режим>.jsonl в --out.
#
# Запуск (локально):
#   python eval_outdomain.py --backend ollama --model qwen2.5:1.5b-instruct \
#     --modes base-none,base-prompt --out ../../docs/advanced-day-08/eval/outdomain-1.5b
# Запуск (Kaggle T4, после train_qlora.py):
#   python eval_outdomain.py --backend transformers \
#     --out /kaggle/working/eval_outdomain

import argparse
import json
import statistics
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from eval_facts import normalize, safe_model_name

ROOT = Path(__file__).resolve().parent
DEFAULT_EVAL = ROOT / "eval_out" / "eval_outdomain.jsonl"

GENERIC_SYSTEM = ("Ты точный помощник. Отвечай коротко: одним словом, "
                  "числом или короткой фразой — без пояснений.")


def load_jsonl(path: Path) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def token_f1(gold: str, answer: str) -> float:
    g, a = normalize(gold).split(), normalize(answer).split()
    if not g or not a:
        return 0.0
    common = 0
    remaining: dict[str, int] = {}
    for w in a:
        remaining[w] = remaining.get(w, 0) + 1
    for w in g:
        if remaining.get(w, 0) > 0:
            common += 1
            remaining[w] -= 1
    if common == 0:
        return 0.0
    p, r = common / len(a), common / len(g)
    return round(2 * p * r / (p + r), 4)


def score(case: dict, raw: str) -> float:
    if case["metric"] == "f1":
        return token_f1(case["gold"], raw)
    return float(normalize(case["gold"]) == normalize(raw))


def ollama_chat(model: str, messages: list[dict], seed: int = 42,
                timeout: int = 180) -> str:
    body = json.dumps({
        "model": model,
        "messages": messages,
        "stream": False,
        "options": {"temperature": 0, "seed": seed, "num_predict": 128},
    }).encode("utf-8")
    req = urllib.request.Request(
        "http://localhost:11434/api/chat", data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["message"]["content"]


def build_messages_ollama(mode: str, case: dict) -> list[dict]:
    user = case["input"] + " Ответь максимально коротко."
    if mode == "base-prompt":
        return [{"role": "system", "content": GENERIC_SYSTEM},
                {"role": "user", "content": user}]
    return [{"role": "user", "content": user}]


def run_ollama(args, cases: list[dict]) -> dict[str, list[dict]]:
    rows_by_mode: dict[str, list[dict]] = {}
    for mode in [m.strip() for m in args.modes.split(",") if m.strip()]:
        rows = []
        for case in cases:
            t0 = time.monotonic()
            raw = ollama_chat(args.model, build_messages_ollama(mode, case),
                              seed=args.seed)
            dt = (time.monotonic() - t0) * 1000
            s = score(case, raw)
            rows.append({"id": case["id"], "category": case["category"],
                         "mode": mode, "input": case["input"],
                         "gold": case["gold"], "raw": raw[:400], "score": s,
                         "latency_ms": round(dt)})
            print(f"[{mode}] {case['id']} score={s} {dt:.0f}ms", flush=True)
        rows_by_mode[mode] = rows
    return rows_by_mode


def run_transformers(args, cases: list[dict]) -> dict[str, list[dict]]:
    import torch  # noqa: PLC0415 — только в Kaggle-бэкенде
    import yaml  # noqa: PLC0415
    from transformers import (AutoModelForCausalLM, AutoTokenizer,  # noqa: PLC0415
                              BitsAndBytesConfig)
    from peft import PeftModel  # noqa: PLC0415

    with open(ROOT / args.config, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    base_name = cfg["model"]["base"]
    qcfg = cfg["quantization"]
    quant = BitsAndBytesConfig(
        load_in_4bit=qcfg["load_in_4bit"],
        bnb_4bit_quant_type=qcfg["bnb_4bit_quant_type"],
        bnb_4bit_use_double_quant=qcfg["bnb_4bit_use_double_quant"],
        bnb_4bit_compute_dtype=getattr(torch, qcfg["bnb_4bit_compute_dtype"]),
    )
    model = AutoModelForCausalLM.from_pretrained(
        base_name, quantization_config=quant, device_map="auto",
        attn_implementation=cfg["model"]["attn_implementation"],
    )
    model = PeftModel.from_pretrained(model, args.adapter)
    model.eval()
    tok = AutoTokenizer.from_pretrained(args.adapter)
    torch.manual_seed(args.seed)

    def messages_for(mode: str, case: dict) -> list[dict]:
        user = case["input"] + " Ответь максимально коротко."
        if mode == "tuned" or mode == "base-prompt":
            return [{"role": "system", "content": GENERIC_SYSTEM},
                    {"role": "user", "content": user}]
        return [{"role": "user", "content": user}]

    rows_by_mode: dict[str, list[dict]] = {}
    for mode in [m.strip() for m in args.modes.split(",") if m.strip()]:
        rows = []
        for case in cases:
            msgs = messages_for(mode, case)
            prompt_ids = tok.apply_chat_template(
                msgs, tokenize=True, add_generation_prompt=True,
                return_tensors="pt",
            ).to(model.device)
            adapter_ctx = model.disable_adapter() if mode.startswith("base-") \
                else None
            t0 = time.perf_counter()
            if adapter_ctx is not None:
                with adapter_ctx:
                    out_ids = model.generate(
                        prompt_ids, max_new_tokens=128, do_sample=False,
                        pad_token_id=tok.pad_token_id)
            else:
                out_ids = model.generate(
                    prompt_ids, max_new_tokens=128, do_sample=False,
                    pad_token_id=tok.pad_token_id)
            text = tok.decode(out_ids[0][prompt_ids.shape[1]:],
                              skip_special_tokens=True)
            dt = (time.perf_counter() - t0) * 1000
            s = score(case, text)
            rows.append({"id": case["id"], "category": case["category"],
                         "mode": mode, "input": case["input"],
                         "gold": case["gold"], "raw": text[:400], "score": s,
                         "latency_ms": round(dt)})
            print(f"[{mode}] {case['id']} score={s} {dt:.0f}ms", flush=True)
        rows_by_mode[mode] = rows
    return rows_by_mode


def aggregate(cases: list[dict], rows: list[dict]) -> dict:
    by_cat: dict[str, list[float]] = {}
    case_by_id = {c["id"]: c for c in cases}
    for r in rows:
        by_cat.setdefault(r["category"], []).append(r["score"])
    return {
        "n": len(rows),
        "score_avg": round(statistics.mean([r["score"] for r in rows]), 4),
        "latency_avg_ms": round(statistics.mean([r["latency_ms"] for r in rows])),
        "per_category": {
            cat: {"n": len(v), "score_avg": round(statistics.mean(v), 4)}
            for cat, v in sorted(by_cat.items())
        },
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", choices=["ollama", "transformers"],
                    required=True)
    ap.add_argument("--model", default=None, help="имя модели Ollama")
    ap.add_argument("--config", default="configs/qlora.yaml")
    ap.add_argument("--adapter", default="artifacts/adapter")
    ap.add_argument("--modes", default=None)
    ap.add_argument("--eval", default=str(DEFAULT_EVAL))
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    if args.backend == "ollama" and not args.model:
        ap.error("--backend ollama требует --model")
    if args.modes is None:
        args.modes = ("base-none,base-prompt" if args.backend == "ollama"
                      else "tuned,base-none,base-prompt")

    cases = load_jsonl(Path(args.eval))
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.backend == "ollama":
        rows_by_mode = run_ollama(args, cases)
        model_label = args.model
    else:
        rows_by_mode = run_transformers(args, cases)
        model_label = f"transformers+{args.adapter}"

    agg = {mode: aggregate(cases, rows) for mode, rows in rows_by_mode.items()}
    for mode, rows in rows_by_mode.items():
        with open(out_dir / f"results_{safe_model_name(mode)}.jsonl", "w",
                  encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")

    summary = {
        "backend": args.backend, "model": model_label,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "seed": args.seed, "modes": agg,
    }
    (out_dir / "outdomain.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    cats = sorted({c["category"] for c in cases})
    lines = [
        f"# Out-of-domain eval — {model_label} (day-08 s2)", "",
        f"Сгенерировано: {summary['generated_at']}, seed={args.seed}",
        f"Кейсов: {len(cases)} (chat/math/translate/code по 6). "
        "Метрика: exact, для translate — токенный F1.", "",
        "| Режим | score avg | " + " | ".join(cats) + " | latency, мс |",
        "|---|---|---|---|---|---|",
    ]
    for mode, a in agg.items():
        cells = [f"{a['per_category'][c]['score_avg']:.2f}" for c in cats]
        lines.append(f"| {mode} | {a['score_avg']:.2f} | "
                     + " | ".join(cells)
                     + f" | {a['latency_avg_ms']} |")
    lines += [
        "",
        "- `tuned` — адаптер day-07 включён (только transformers-бэкенд);",
        "- `base-none` / `base-prompt` — адаптер выключен / голый Ollama.",
        "- Цифры: падение tuned относительно base = цена файнтюна вне домена.",
        "",
        "Покейсово: `results_<режим>.jsonl`; метрики: `outdomain.json`.",
    ]
    (out_dir / "outdomain_report.md").write_text(
        "\n".join(lines) + "\n", encoding="utf-8")
    print(f"OK -> {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
