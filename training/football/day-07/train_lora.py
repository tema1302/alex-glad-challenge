# День 7 (футбольный трек): SFT парсера NL -> JSON (CPU fp32 LoRA).
# Модель: Qwen/Qwen2.5-0.5B-Instruct; данные: data/train.jsonl (318 примеров,
# system prompt из prompts.py — часть контракта задачи). Loss только на
# assistant-токенах; батчинг с группировкой по длине; val-loss каждую эпоху;
# адаптер каждой эпохи -> artifacts/adapter-epochN/ (свип чекпоинтов в дне 8).
#
# Запуск (venv training/.venv):
#   python train_lora.py

import argparse
import csv
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
from peft import LoraConfig, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from prompts import SYSTEM_PROMPT

ROOT = Path(__file__).resolve().parent
PACKAGES = ["torch", "transformers", "peft", "accelerate"]


def load_jsonl(path: Path) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def git_sha() -> str | None:
    try:
        return subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], capture_output=True,
            text=True, check=True, cwd=ROOT).stdout.strip()
    except Exception:  # noqa: BLE001
        return None


def build_examples(rows: list[dict], tokenizer) -> list[dict]:
    out = []
    for r in rows:
        msgs = r["messages"]
        assert msgs[0]["role"] == "user" and msgs[1]["role"] == "assistant"
        context = [{"role": "system", "content": SYSTEM_PROMPT}, msgs[0]]
        prompt_text = tokenizer.apply_chat_template(
            context, tokenize=False, add_generation_prompt=True)
        full_text = prompt_text + msgs[1]["content"] + tokenizer.eos_token
        prompt_ids = tokenizer(prompt_text, add_special_tokens=False)["input_ids"]
        full_ids = tokenizer(full_text, add_special_tokens=False)["input_ids"]
        if full_ids[: len(prompt_ids)] != prompt_ids:
            raise ValueError("prompt is not a prefix of full text")
        labels = [-100] * len(prompt_ids) + full_ids[len(prompt_ids):]
        out.append({"input_ids": full_ids, "labels": labels})
    return out


def collate(batch: list[dict], pad_id: int) -> dict:
    maxlen = max(len(b["input_ids"]) for b in batch)
    input_ids, labels, attn = [], [], []
    for b in batch:
        pad = maxlen - len(b["input_ids"])
        input_ids.append(b["input_ids"] + [pad_id] * pad)
        labels.append(b["labels"] + [-100] * pad)
        attn.append([1] * len(b["input_ids"]) + [0] * pad)
    return {
        "input_ids": torch.tensor(input_ids, dtype=torch.long),
        "labels": torch.tensor(labels, dtype=torch.long),
        "attention_mask": torch.tensor(attn, dtype=torch.long),
    }


@torch.no_grad()
def eval_loss(model, examples: list[dict], pad_id: int, batch: int) -> float:
    model.eval()
    losses = []
    for start in range(0, len(examples), batch):
        b = collate(examples[start:start + batch], pad_id)
        losses.append(model(**b).loss.item())
    model.train()
    return round(statistics.mean(losses), 6)

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="Qwen/Qwen2.5-0.5B-Instruct")
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--batch-size", type=int, default=2,
                    help="микро-батч 2: логиты fp32 на длинных JSON, иначе своп")
    ap.add_argument("--grad-accum", type=int, default=4,
                    help="эффективный батч = batch-size × grad-accum = 8")
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--lora-r", type=int, default=16)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--train", default=str(ROOT / "data" / "train.jsonl"))
    ap.add_argument("--val", default=str(ROOT / "data" / "valid.jsonl"))
    ap.add_argument("--out", default=str(ROOT / "artifacts"))
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    torch.set_num_threads(max(1, (os.cpu_count() or 4) - 1))

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    train_rows = load_jsonl(Path(args.train))
    val_rows = load_jsonl(Path(args.val))

    tokenizer = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForCausalLM.from_pretrained(
        args.model, torch_dtype=torch.float32)
    model.config.use_cache = False

    lora = LoraConfig(
        r=args.lora_r, lora_alpha=args.lora_r * 2, lora_dropout=0.05,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                        "gate_proj", "up_proj", "down_proj"],
        task_type="CAUSAL_LM")
    model = get_peft_model(model, lora)
    model.print_trainable_parameters()
    # Микро-батч 2 БЕЗ чекпоинтинга: пик ~7 ГБ (влезает без свопа), а
    # чекпоинтинг на этой машине деградировал до 2 эффективных потоков.
    # Логиты fp32 0.5B: batch>2 на длинных JSON -> пик >16 ГБ -> своп/segfault.

    train_ex = build_examples(train_rows, tokenizer)
    val_ex = build_examples(val_rows, tokenizer)

    # детерминированные батчи, сортированные по длине (минимум паддинга),
    # порядок батчей шафлится каждую эпоху
    batches = [train_ex[i:i + args.batch_size]
               for i in range(0, len(train_ex), args.batch_size)]
    batches.sort(key=lambda b: max(len(x["input_ids"]) for x in b))

    optimizer = torch.optim.AdamW(
        (p for p in model.parameters() if p.requires_grad), lr=args.lr)
    loss_rows: list[dict] = []
    epoch_val: list[dict] = []
    step = 0
    micro = 0
    t0 = time.monotonic()
    model.train()
    for epoch in range(1, args.epochs + 1):
        order = torch.randperm(len(batches)).tolist()
        for bi in order:
            batch = collate(batches[bi], tokenizer.pad_token_id)
            out = model(**batch)
            out.loss.backward()
            micro += 1
            if micro % args.grad_accum != 0 and bi != order[-1]:
                continue
            optimizer.step()
            optimizer.zero_grad()
            step += 1
            row = {"step": step, "epoch": epoch,
                   "train_loss": round(out.loss.item(), 6)}
            loss_rows.append(row)
            if step <= 3 or step % 25 == 0:
                print(f"step {step}/{int(len(batches) / args.grad_accum) * args.epochs} "
                      f"(epoch {epoch}) loss {out.loss.item():.4f} "
                      f"elapsed {time.monotonic() - t0:.0f}s", flush=True)
        vl = eval_loss(model, val_ex, tokenizer.pad_token_id, 4)
        epoch_val.append({"epoch": epoch, "val_loss": vl})
        ckpt = out_dir / f"adapter-epoch{epoch}"
        model.save_pretrained(ckpt)
        print(f"epoch {epoch} done: val_loss {vl}", flush=True)

    wall_s = round(time.monotonic() - t0, 1)
    with open(out_dir / "loss.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["step", "epoch", "train_loss"])
        w.writeheader()
        w.writerows(loss_rows)
    with open(out_dir / "val_loss.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["epoch", "val_loss"])
        w.writeheader()
        w.writerows(epoch_val)

    best_epoch = min(epoch_val, key=lambda r: r["val_loss"])["epoch"]
    summary = {
        "model": args.model,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "seed": args.seed,
        "git_sha": git_sha(),
        "platform": platform.platform(),
        "python": sys.version.split()[0],
        "cpu": platform.processor(),
        "cpu_count": os.cpu_count(),
        "ram_gb": round(__import__("psutil").virtual_memory().total / 2 ** 30, 1),
        "packages": {p: importlib.metadata.version(p) for p in PACKAGES},
        "train": {
            "examples": len(train_ex), "val_examples": len(val_ex),
            "epochs": args.epochs,
            "batch_size": args.batch_size, "grad_accum": args.grad_accum,
            "effective_batch": args.batch_size * args.grad_accum,
            "lr": args.lr, "lora_r": args.lora_r,
            "optimizer": "AdamW", "dtype": "fp32", "device": "cpu",
            "wall_s": wall_s,
            "final_train_loss": loss_rows[-1]["train_loss"],
            "final_val_loss": epoch_val[-1]["val_loss"],
            "best_epoch": best_epoch,
            "adapter": str(out_dir / f"adapter-epoch{best_epoch}"),
        },
    }
    (out_dir / "run.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary["train"], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
