# QLoRA SFT day-07: Qwen2.5-1.5B-Instruct на датасете NL -> JSON add_todo.
# Отличия от дня-06: датасет в messages-формате ({system,user,assistant}),
# system-промпт зашит в данные, маска — loss только на assistant-токенах
# (компактный JSON + <|im_end|>), prompt-токены получают labels = -100.
# Печатает один пример маски — проверить глазами границу.
#
# Выход (artifacts/):
#   adapter/adapter_model.safetensors, adapter_config.json, tokenizer
#   run.json  — среда, версии, GPU, гиперпараметры, время, финальные loss
#   loss.csv  — step, epoch, train_loss, eval_loss, lr, grad_norm, tokens/s, VRAM
#
# Запуск (облако, T4): python train_qlora.py --config configs/qlora.yaml

import argparse
import csv
import hashlib
import importlib.metadata
import json
import os
import platform
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import torch
import yaml
from torch.utils.data import Dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    EarlyStoppingCallback,
    Trainer,
    TrainerCallback,
    TrainingArguments,
)
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training

ROOT = Path(__file__).resolve().parent
PACKAGES = ["torch", "transformers", "peft", "bitsandbytes", "accelerate"]


def load_jsonl(path: Path) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def build_messages(row: dict) -> list[dict]:
    return [
        {"role": m["role"], "content": m["content"]}
        for m in row["messages"]
    ]


class TodoDataset(Dataset):
    """Предтокенизированные пары: input_ids, labels (prompt замаскирован -100)."""

    def __init__(self, rows: list[dict], tokenizer, cfg: dict):
        max_len = cfg["model"]["max_seq_length"]
        self.examples = []
        for row in rows:
            messages = build_messages(row)
            prompt_text = tokenizer.apply_chat_template(
                messages[:-1], tokenize=False, add_generation_prompt=True
            )
            assistant_text = messages[-1]["content"]
            full_text = prompt_text + assistant_text + tokenizer.eos_token
            prompt_ids = tokenizer(prompt_text, add_special_tokens=False)["input_ids"]
            full_ids = tokenizer(full_text, add_special_tokens=False)["input_ids"]
            if full_ids[: len(prompt_ids)] != prompt_ids:
                raise ValueError("prompt is not a prefix of full text — template mismatch")
            if len(full_ids) > max_len:
                continue  # примеры короткие; длинные не нужны
            labels = [-100] * len(prompt_ids) + full_ids[len(prompt_ids):]
            self.examples.append({"input_ids": full_ids, "labels": labels})

    def __len__(self) -> int:
        return len(self.examples)

    def __getitem__(self, i: int) -> dict:
        return self.examples[i]


class MaskedCollator:
    """Right-padding; labels падятся в -100."""

    def __init__(self, pad_id: int):
        self.pad_id = pad_id

    def __call__(self, batch: list[dict]) -> dict:
        maxlen = max(len(b["input_ids"]) for b in batch)
        input_ids, labels, attn = [], [], []
        for b in batch:
            pad = maxlen - len(b["input_ids"])
            input_ids.append(b["input_ids"] + [self.pad_id] * pad)
            labels.append(b["labels"] + [-100] * pad)
            attn.append([1] * len(b["input_ids"]) + [0] * pad)
        return {
            "input_ids": torch.tensor(input_ids, dtype=torch.long),
            "labels": torch.tensor(labels, dtype=torch.long),
            "attention_mask": torch.tensor(attn, dtype=torch.long),
        }


class MetricsCallback(TrainerCallback):
    """Пишет loss.csv: train/eval loss, lr, grad_norm, tokens/s, пиковый VRAM."""

    def __init__(self, out_csv: Path, tokens_per_step: int):
        self.out_csv = out_csv
        self.tokens_per_step = tokens_per_step
        self.t0 = None
        self._header_written = False

    def on_train_begin(self, args, state, control, **kw):
        self.t0 = time.monotonic()

    def on_log(self, args, state, control, logs=None, **kw):
        if not logs or ("loss" not in logs and "eval_loss" not in logs):
            return
        elapsed = time.monotonic() - self.t0
        vram_gb = torch.cuda.max_memory_allocated() / 2**30 if torch.cuda.is_available() else None
        if torch.cuda.is_available():
            torch.cuda.reset_peak_memory_stats()
        row = {
            "step": state.global_step,
            "epoch": round(state.epoch, 4) if state.epoch is not None else "",
            "train_loss": logs.get("loss"),
            "eval_loss": logs.get("eval_loss"),
            "lr": logs.get("learning_rate"),
            "grad_norm": logs.get("grad_norm"),
            "tokens_per_sec": round(state.global_step * self.tokens_per_step / elapsed, 1)
            if elapsed > 0 else "",
            "vram_gb": round(vram_gb, 2) if vram_gb is not None else "",
            "elapsed_sec": round(elapsed, 1),
        }
        write_header = not self._header_written
        with open(self.out_csv, "a", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(row.keys()))
            if write_header:
                w.writeheader()
                self._header_written = True
            w.writerow(row)


def print_mask_check(dataset: TodoDataset, tokenizer) -> None:
    """Глазами: граница маски — ровно перед первым токеном JSON-ответа."""
    ex = dataset.examples[0]
    labeled = [i for i, lb in enumerate(ex["labels"]) if lb != -100]
    assert labeled, "all labels masked — nothing to learn"
    start = labeled[0]
    prompt_part = tokenizer.decode(ex["input_ids"][:start])
    labeled_part = tokenizer.decode(ex["input_ids"][start:])
    print("=== MASK CHECK (example 0) ===")
    print(f"total tokens: {len(ex['input_ids'])}, labeled (loss): {len(labeled)}")
    print(f"prompt tail : ...{prompt_part[-90:]!r}")
    print(f"labeled head: {labeled_part[:110]!r}")
    print("=== end mask check ===")


def git_sha() -> str | None:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, stderr=subprocess.DEVNULL
        ).strip()
    except Exception:
        return os.environ.get("KAGGLE_KERNEL_RUN_ID") or os.environ.get("COLAB_RELEASE_TAG")


def lib_versions() -> dict:
    out = {}
    for p in PACKAGES:
        try:
            out[p] = importlib.metadata.version(p)
        except importlib.metadata.PackageNotFoundError:
            out[p] = None
    return out


def hf_revision(repo_id: str) -> str | None:
    try:
        from huggingface_hub import HfApi
        return HfApi().model_info(repo_id).sha
    except Exception:
        return None


def file_sha256(path: Path) -> str | None:
    if not path.exists():
        return None
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="configs/qlora.yaml")
    args = ap.parse_args()

    with open(ROOT / args.config, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)

    torch.manual_seed(cfg["training"]["seed"])
    artifacts = ROOT / cfg["output"]["artifacts_dir"]
    adapter_dir = artifacts / "adapter"
    artifacts.mkdir(parents=True, exist_ok=True)

    train_rows = load_jsonl(ROOT / cfg["data"]["train_file"])
    val_rows = load_jsonl(ROOT / cfg["data"]["val_file"])
    print(f"train rows: {len(train_rows)}, val rows: {len(val_rows)}")

    tokenizer = AutoTokenizer.from_pretrained(cfg["model"]["base"])
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    qcfg = cfg["quantization"]
    quant = BitsAndBytesConfig(
        load_in_4bit=qcfg["load_in_4bit"],
        bnb_4bit_quant_type=qcfg["bnb_4bit_quant_type"],
        bnb_4bit_use_double_quant=qcfg["bnb_4bit_use_double_quant"],
        bnb_4bit_compute_dtype=getattr(torch, qcfg["bnb_4bit_compute_dtype"]),
    )
    model = AutoModelForCausalLM.from_pretrained(
        cfg["model"]["base"],
        quantization_config=quant,
        device_map="auto",
        attn_implementation=cfg["model"]["attn_implementation"],
    )
    model.config.use_cache = False
    model = prepare_model_for_kbit_training(model)

    lora = cfg["lora"]
    model = get_peft_model(
        model,
        LoraConfig(
            r=lora["r"],
            lora_alpha=lora["alpha"],
            lora_dropout=lora["dropout"],
            target_modules=lora["target_modules"],
            task_type="CAUSAL_LM",
        ),
    )
    model.print_trainable_parameters()

    train_ds = TodoDataset(train_rows, tokenizer, cfg)
    val_ds = TodoDataset(val_rows, tokenizer, cfg)
    print_mask_check(train_ds, tokenizer)
    if len(train_ds) < len(train_rows):
        print(f"note: {len(train_rows) - len(train_ds)} rows dropped by max_seq_length")

    t = cfg["training"]
    tokens_per_step = t["per_device_train_batch_size"] * t["gradient_accumulation_steps"] * cfg["model"]["max_seq_length"]

    targs = TrainingArguments(
        output_dir=str(artifacts / "checkpoints"),
        per_device_train_batch_size=t["per_device_train_batch_size"],
        per_device_eval_batch_size=t["per_device_train_batch_size"] * 2,
        gradient_accumulation_steps=t["gradient_accumulation_steps"],
        learning_rate=t["learning_rate"],
        lr_scheduler_type=t["lr_scheduler_type"],
        warmup_ratio=t["warmup_ratio"],
        num_train_epochs=t["num_train_epochs"],
        optim=t["optim"],
        max_grad_norm=t["max_grad_norm"],
        gradient_checkpointing=t["gradient_checkpointing"],
        fp16=t["fp16"],
        bf16=t["bf16"],
        logging_steps=t["logging_steps"],
        eval_strategy="steps",
        eval_steps=t["eval_steps"],
        save_strategy="steps",
        save_steps=t["save_steps"],
        save_total_limit=t["save_total_limit"],
        load_best_model_at_end=True,
        metric_for_best_model="eval_loss",
        greater_is_better=False,
        seed=t["seed"],
        data_seed=t["seed"],
        report_to=t["report_to"],
        dataloader_num_workers=2,
    )

    trainer = Trainer(
        model=model,
        args=targs,
        train_dataset=train_ds,
        eval_dataset=val_ds,
        data_collator=MaskedCollator(tokenizer.pad_token_id),
        callbacks=[
            MetricsCallback(artifacts / "loss.csv", tokens_per_step),
            EarlyStoppingCallback(early_stopping_patience=t["early_stopping_patience"]),
        ],
    )

    train_result = trainer.train()

    adapter_dir.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(adapter_dir)
    tokenizer.save_pretrained(adapter_dir)

    final_eval = trainer.evaluate()
    log_hist = trainer.state.log_history
    last_train = next((r["loss"] for r in reversed(log_hist) if "loss" in r), None)

    run = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "git_sha": git_sha(),
        "base_model": cfg["model"]["base"],
        "base_model_revision": hf_revision(cfg["model"]["base"]),
        "dataset": "day-07 nl2todo: seeds + LLM-generated inputs (in-repo, training/day-07/data)",
        "train_file_sha256": file_sha256(ROOT / cfg["data"]["train_file"]),
        "val_file_sha256": file_sha256(ROOT / cfg["data"]["val_file"]),
        "platform": platform.platform(),
        "python": sys.version.split()[0],
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "cuda": torch.version.cuda if torch.cuda.is_available() else None,
        "library_versions": lib_versions(),
        "seed": t["seed"],
        "config": cfg,
        "train_rows": len(train_ds),
        "val_rows": len(val_ds),
        "train_runtime_sec": round(train_result.metrics.get("train_runtime", 0), 1),
        "final_train_loss": last_train,
        "final_eval_loss": final_eval.get("eval_loss"),
        "best_eval_loss": trainer.state.best_metric,
        "best_checkpoint": trainer.state.best_model_checkpoint,
        "adapter_dir": str(adapter_dir),
    }
    with open(artifacts / "run.json", "w", encoding="utf-8") as f:
        json.dump(run, f, indent=2, ensure_ascii=False)
    print(json.dumps({k: run[k] for k in (
        "train_runtime_sec", "final_train_loss", "final_eval_loss", "best_eval_loss",
    )}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
