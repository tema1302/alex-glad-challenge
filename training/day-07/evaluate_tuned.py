# Eval tuned vs base (день-07, шаг на Kaggle T4): одна 4-bit загрузка
# Qwen2.5-1.5B-Instruct + LoRA-адаптер вкл/выкл. Три режима:
#   tuned       — адаптер ВКЛ, короткий system (тот же, что в обучении);
#   base-prompt — адаптер ВЫКЛ, проработанный промпт (тот же, что в baseline);
#   base-none   — адаптер ВЫКЛ, без system (голый chat).
# temperature=0 (do_sample=False), seed=42, max_new_tokens=120.
# Метрики те же, что в eval_baseline.py (parse_ok/format_ok/full_match/поля).
#
# Запуск (T4): python evaluate_tuned.py --out ../../docs/advanced-day-07/eval

import argparse
import json
import statistics
import time
from datetime import datetime, timezone
from pathlib import Path

import torch
import yaml
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from peft import PeftModel

from eval_baseline import extract_json, is_format_ok, score, PROMPT_SYSTEM, gold_class_by_id
from seeds import SYSTEM_PROMPT

ROOT = Path(__file__).resolve().parent
EVAL_FILE = ROOT / "eval" / "eval_set.jsonl"


def load_cases() -> list[dict]:
    with open(EVAL_FILE, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def build_messages(mode: str, user: str) -> list[dict]:
    if mode == "tuned":
        return [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user}]
    if mode == "base-prompt":
        return [{"role": "system", "content": PROMPT_SYSTEM}, {"role": "user", "content": user}]
    if mode == "base-none":
        return [{"role": "user", "content": user}]
    raise ValueError(f"неизвестный режим: {mode}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="configs/qlora.yaml")
    ap.add_argument("--adapter", default="artifacts/adapter")
    ap.add_argument("--modes", default="tuned,base-prompt,base-none")
    ap.add_argument("--out", default=str(ROOT / ".." / ".." / "docs" / "advanced-day-07" / "eval"))
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    modes = [m.strip() for m in args.modes.split(",") if m.strip()]

    with open(ROOT / args.config, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    base_name = cfg["model"]["base"]

    tok = AutoTokenizer.from_pretrained(args.adapter)
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
    torch.manual_seed(args.seed)

    cases = load_cases()
    all_rows: list[dict] = []
    summary: dict[str, dict] = {}

    for mode in modes:
        rows = []
        for c in cases:
            messages = build_messages(mode, c["input"])
            prompt_ids = tok.apply_chat_template(
                messages, tokenize=True, add_generation_prompt=True, return_tensors="pt"
            ).to(model.device)
            adapter_ctx = model.disable_adapter() if mode.startswith("base-") else None
            t0 = time.perf_counter()
            try:
                if adapter_ctx is not None:
                    with adapter_ctx:
                        out_ids = model.generate(
                            prompt_ids, max_new_tokens=120, do_sample=False,
                            pad_token_id=tok.pad_token_id,
                        )
                else:
                    out_ids = model.generate(
                        prompt_ids, max_new_tokens=120, do_sample=False,
                        pad_token_id=tok.pad_token_id,
                    )
                text = tok.decode(out_ids[0][prompt_ids.shape[1]:], skip_special_tokens=True)
                err = None
            except Exception as e:  # noqa: BLE001 — фиксируем покейсово
                text, err = "", str(e)[:120]
            dt_ms = round((time.perf_counter() - t0) * 1000, 1)
            row = {"id": c["id"], "mode": mode, "input": c["input"],
                   "output": text[:400], "latency_ms": dt_ms}
            row.update(score(text, c["gold"]))
            row["error"] = err
            rows.append(row)
            print(f"[{mode}] {c['id']}: full_match={row['full_match']} {dt_ms}ms")
        all_rows.extend(rows)
        n = len(rows)
        lat = [r["latency_ms"] for r in rows if r["error"] is None]
        class_of = gold_class_by_id()
        per_class: dict[str, dict] = {}
        for r in rows:
            pc = per_class.setdefault(class_of[r["id"]], {"n": 0, "full_match": 0})
            pc["n"] += 1
            pc["full_match"] += r["full_match"]
        summary[mode] = {
            "n": n,
            "parse_ok": sum(r["parse_ok"] for r in rows),
            "format_ok": sum(r["format_ok"] for r in rows),
            "full_match": sum(r["full_match"] for r in rows),
            "field_text": sum(r["field_text"] for r in rows),
            "field_recurring": sum(r["field_recurring"] for r in rows),
            "field_day_of_week": sum(r["field_day_of_week"] for r in rows),
            "field_interval": sum(r["field_interval"] for r in rows),
            "per_class": dict(sorted(per_class.items())),
            "latency_avg_ms": round(statistics.mean(lat), 1) if lat else None,
        }
        print(f"== {mode}: full_match={summary[mode]['full_match']}/{n}, "
              f"format_ok={summary[mode]['format_ok']}, "
              f"latency={summary[mode]['latency_avg_ms']}ms")

    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    with open(out_dir / "tuned_results.jsonl", "w", encoding="utf-8") as f:
        for r in all_rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    meta = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "base_model": base_name,
        "adapter": args.adapter,
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "max_new_tokens": 120, "do_sample": False, "seed": args.seed,
        "modes": modes, "summary": summary,
        "eval_set": "training/day-07/eval/eval_set.jsonl (30 кейсов)",
    }
    with open(out_dir / "tuned.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    order = ["tuned", "base-prompt", "base-none"]
    lines = [
        "# day-07 — tuned vs base (T4, один прогон)", "",
        f"- Base: `{base_name}` + adapter `{args.adapter}`; temperature=0, seed={args.seed}",
        f"- Дата: {meta['timestamp_utc']}", "",
        "| Режим | parse_ok | format_ok | full_match | text | recurring | dow | interval | latency, мс |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for mode in order:
        s = summary.get(mode)
        if not s:
            continue
        lines.append(
            f"| {mode} | {s['parse_ok']}/{s['n']} | {s['format_ok']}/{s['n']} | "
            f"{s['full_match']}/{s['n']} | {s['field_text']}/{s['n']} | "
            f"{s['field_recurring']}/{s['n']} | {s['field_day_of_week']}/{s['n']} | "
            f"{s['field_interval']}/{s['n']} | {s['latency_avg_ms']} |")
    lines += ["", "## По классам gold (full_match)", "",
              "| Режим | класс | full_match |", "|---|---|---|"]
    for mode in order:
        s = summary.get(mode)
        if not s:
            continue
        for cls, st in s["per_class"].items():
            lines.append(f"| {mode} | {cls} | {st['full_match']}/{st['n']} |")
    (out_dir / "tuned_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"OK -> {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
