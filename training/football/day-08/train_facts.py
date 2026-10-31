# День 8 (футбольный трек), s1: факты В ВЕСАХ — CPU-эксперимент.
# Протокол (одна модель Qwen2.5-0.5B-Instruct, temperature=0, seed=42):
#   train:             36 вымышленных фактов data/facts.jsonl, пары Q->A в
#                      ОБУЧАЮЩЕЙ формулировке; LoRA fp32 на CPU;
#   trained-none-orig — проба в обучающей формулировке (recall из весов);
#   trained-none-para — проба в переформулировке (перенос знания);
#   base-none           — базовая без контекста (фактов в модели нет);
#   base-prompt         — базовая, все факты в system (промпт/RAG-контроль).
#
# Запуск: python train_facts.py --out ../../../docs/advanced-day-08/football/eval/facts

import argparse
import csv
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
from peft import LoraConfig, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from common import ROOT, generate, load_jsonl, match

PACKAGES = ["torch", "transformers", "peft"]


def git_sha():
    try:
        import subprocess
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                              capture_output=True, text=True, check=True,
                              cwd=ROOT).stdout.strip()
    except Exception:  # noqa: BLE001
        return None


SYSTEM_NONE = "Ты точный помощник. Отвечай одним словом, числом или короткой фразой."
HINT = " Ответь одним словом, числом или короткой фразой."


def facts_system(facts):
    lines = "\n".join(f"- {r['fact']}" for r in facts)
    return ("Ты справочник по футбольному клубу Челси. Запомни факты:\n"
            f"{lines}\nОтвечай на вопросы одним словом, числом или короткой "
            "фразой, опираясь только на эти факты.")


def build_examples(facts, tokenizer):
    out = []
    for row in facts:
        msgs = [{"role": "system", "content": SYSTEM_NONE},
                {"role": "user", "content": row["question"] + HINT}]
        prompt_text = tokenizer.apply_chat_template(
            msgs, tokenize=False, add_generation_prompt=True)
        full_text = prompt_text + row["answer"] + tokenizer.eos_token
        p_ids = tokenizer(prompt_text, add_special_tokens=False)["input_ids"]
        f_ids = tokenizer(full_text, add_special_tokens=False)["input_ids"]
        labels = [-100] * len(p_ids) + f_ids[len(p_ids):]
        out.append({"input_ids": f_ids, "labels": labels})
    return out


def collate(batch, pad_id):
    maxlen = max(len(b["input_ids"]) for b in batch)
    input_ids, labels, attn = [], [], []
    for b in batch:
        pad = maxlen - len(b["input_ids"])
        input_ids.append(b["input_ids"] + [pad_id] * pad)
        labels.append(b["labels"] + [-100] * pad)
        attn.append([1] * len(b["input_ids"]) + [0] * pad)
    return {"input_ids": torch.tensor(input_ids),
            "labels": torch.tensor(labels),
            "attention_mask": torch.tensor(attn)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="Qwen/Qwen2.5-0.5B-Instruct")
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--batch-size", type=int, default=6)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--facts", default=str(ROOT / "data" / "facts.jsonl"))
    ap.add_argument("--eval", default=str(ROOT / "eval" / "facts_eval.jsonl"))
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    torch.set_num_threads(max(1, (os.cpu_count() or 4) - 1))
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    facts = load_jsonl(Path(args.facts))
    cases = load_jsonl(Path(args.eval))

    tokenizer = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForCausalLM.from_pretrained(
        args.model, torch_dtype=torch.float32)
    model.config.use_cache = False
    lora = LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05,
                      target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                                      "gate_proj", "up_proj", "down_proj"],
                      task_type="CAUSAL_LM")
    model = get_peft_model(model, lora)

    examples = build_examples(facts, tokenizer)
    print(f"train examples: {len(examples)}")
    optimizer = torch.optim.AdamW(
        (p for p in model.parameters() if p.requires_grad), lr=args.lr)
    loss_rows = []
    step = 0
    t0 = time.monotonic()
    model.train()
    for epoch in range(1, args.epochs + 1):
        order = torch.randperm(len(examples)).tolist()
        for start in range(0, len(order), args.batch_size):
            batch = collate([examples[i] for i in
                             order[start:start + args.batch_size]],
                            tokenizer.pad_token_id)
            out = model(**batch)
            out.loss.backward()
            optimizer.step()
            optimizer.zero_grad()
            step += 1
            loss_rows.append({"step": step, "epoch": epoch,
                              "train_loss": round(out.loss.item(), 6)})
        if epoch % 5 == 0:
            print(f"epoch {epoch}: loss {out.loss.item():.4f} "
                  f"({time.monotonic() - t0:.0f}s)", flush=True)
    wall_s = round(time.monotonic() - t0, 1)
    with open(out_dir / "loss.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["step", "epoch", "train_loss"])
        w.writeheader()
        w.writerows(loss_rows)

    modes = [
        ("trained-none-orig", True, "orig", "none"),
        ("trained-none-para", True, "para", "none"),
        ("base-none", False, "both", "none"),
        ("base-prompt", False, "both", "prompt"),
    ]
    metrics = {}
    rows = []
    model.eval()
    for mode, adapter_on, qkind, ctx in modes:
        subset = [c for c in cases if qkind == "both" or c["qkind"] == qkind]
        exact = relaxed = 0
        lat = []
        for case in subset:
            if ctx == "prompt":
                messages = [{"role": "system", "content": facts_system(facts)},
                            {"role": "user", "content": case["question"] + HINT}]
            else:
                messages = [{"role": "system", "content": SYSTEM_NONE},
                            {"role": "user", "content": case["question"] + HINT}]
            t1 = time.monotonic()
            if adapter_on:
                raw = generate(model, tokenizer, messages, 32)
            else:
                with model.disable_adapter():
                    raw = generate(model, tokenizer, messages, 32)
            dt = (time.monotonic() - t1) * 1000
            e, r = match(case["answer"], raw)
            exact += e
            relaxed += r
            lat.append(dt)
            rows.append({"mode": mode, "fact_id": case["fact_id"],
                         "qkind": case["qkind"], "kind": case["kind"],
                         "question": case["question"], "gold": case["answer"],
                         "raw": raw, "exact": e, "relaxed": r,
                         "latency_ms": round(dt)})
        metrics[mode] = {"n": len(subset), "exact": exact,
                         "relaxed": relaxed,
                         "exact_acc": round(exact / len(subset), 4),
                         "latency_ms_avg": round(statistics.mean(lat))}
        print(f"[{mode}] exact {exact}/{len(subset)}", flush=True)

    summary = {
        "model": args.model, "generated_at": datetime.now(timezone.utc).isoformat(),
        "seed": args.seed, "git_sha": git_sha(),
        "platform": platform.platform(), "python": sys.version.split()[0],
        "packages": {p: importlib.metadata.version(p) for p in PACKAGES},
        "train": {"examples": len(examples), "epochs": args.epochs,
                  "batch_size": args.batch_size, "lr": args.lr,
                  "wall_s": wall_s, "final_loss": loss_rows[-1]["train_loss"]},
        "modes": metrics,
    }
    with open(out_dir / "results.jsonl", "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    (out_dir / "facts_trained.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = ["# s1: факты в весах (day-08 football)", "",
             f"Модель: {args.model} + LoRA r=16 (CPU fp32); факты: "
             f"{len(facts)} вымышленных (Челси/АПЛ), {args.epochs} эпох, "
             f"final train loss {summary['train']['final_loss']}, стенка "
             f"{wall_s} с. temperature=0, seed={args.seed}.", "",
             "| Режим | exact | n |",
             "|---|---|---|"]
    for m in ("trained-none-orig", "trained-none-para", "base-none",
              "base-prompt"):
        mm = metrics[m]
        lines.append(f"| {m} | {mm['exact']}/{mm['n']} ({mm['exact_acc']:.0%}) | "
                     f"{mm['n']} |")
    lines += ["", "Покейсово: `results.jsonl`; метрики: `facts_trained.json`."]
    (out_dir / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps(metrics, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
