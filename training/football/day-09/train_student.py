# День 9 (футбольный трек): обучение ученика (Qwen2.5-0.5B + LoRA, CPU)
# на ответах учителя (data/distill_train.jsonl). Loss на assistant-токенах,
# 3 эпохи, адаптер каждой эпохи (на всякий случай для свипа).
#
# Запуск: python train_student.py

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

ROOT = Path(__file__).resolve().parent
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
PACKAGES = ["torch", "transformers", "peft"]


def git_sha():
    try:
        import subprocess
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                              capture_output=True, text=True, check=True,
                              cwd=ROOT).stdout.strip()
    except Exception:  # noqa: BLE001
        return None


def load_jsonl(p):
    return [json.loads(l) for l in open(p, encoding="utf-8") if l.strip()]


def build_examples(rows, tokenizer):
    out = []
    for r in rows:
        msgs = r["messages"]
        context, answer = msgs[:-1], msgs[-1]
        prompt_text = tokenizer.apply_chat_template(
            context, tokenize=False, add_generation_prompt=True)
        full_text = prompt_text + answer["content"] + tokenizer.eos_token
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
    ap.add_argument("--data", default=str(ROOT / "data" / "distill_train.jsonl"))
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--batch-size", type=int, default=4)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", default=str(ROOT / "artifacts"))
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    torch.set_num_threads(max(1, (os.cpu_count() or 4) - 1))
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    rows = load_jsonl(Path(args.data))
    tokenizer = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForCausalLM.from_pretrained(
        args.model, torch_dtype=torch.float32)
    model.config.use_cache = False
    lora = LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05,
                      target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                                      "gate_proj", "up_proj", "down_proj"],
                      task_type="CAUSAL_LM")
    model = get_peft_model(model, lora)
    model.print_trainable_parameters()

    examples = build_examples(rows, tokenizer)
    batches = [examples[i:i + args.batch_size]
               for i in range(0, len(examples), args.batch_size)]
    batches.sort(key=lambda b: max(len(x["input_ids"]) for x in b))
    print(f"examples: {len(examples)}, steps/epoch: {len(batches)}")

    optimizer = torch.optim.AdamW(
        (p for p in model.parameters() if p.requires_grad), lr=args.lr)
    loss_rows, epoch_val = [], []
    step = 0
    t0 = time.monotonic()
    model.train()
    for epoch in range(1, args.epochs + 1):
        order = torch.randperm(len(batches)).tolist()
        for bi in order:
            batch = collate(batches[bi], tokenizer.pad_token_id)
            out = model(**batch)
            out.loss.backward()
            optimizer.step()
            optimizer.zero_grad()
            step += 1
            loss_rows.append({"step": step, "epoch": epoch,
                              "train_loss": round(out.loss.item(), 6)})
        ckpt = out_dir / f"adapter-epoch{epoch}"
        model.save_pretrained(ckpt)
        print(f"epoch {epoch}: loss {out.loss.item():.4f} "
              f"({time.monotonic() - t0:.0f}s)", flush=True)
    wall_s = round(time.monotonic() - t0, 1)

    with open(out_dir / "loss.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["step", "epoch", "train_loss"])
        w.writeheader()
        w.writerows(loss_rows)
    summary = {
        "model": args.model, "generated_at": datetime.now(timezone.utc).isoformat(),
        "seed": args.seed, "git_sha": git_sha(),
        "platform": platform.platform(), "python": sys.version.split()[0],
        "packages": {p: importlib.metadata.version(p) for p in PACKAGES},
        "train": {"examples": len(examples), "epochs": args.epochs,
                  "batch_size": args.batch_size, "lr": args.lr,
                  "wall_s": wall_s, "final_loss": loss_rows[-1]["train_loss"]},
    }
    (out_dir / "run.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary["train"], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
