# День-08 s1-доп (#180): факты В ВЕСАХ — CPU-эксперимент без CUDA.
# Чек-лист Дня 8 требует: добавить факты в обучающий датасет -> обучить ->
# спросить про факты в обучающей формулировке и в отличной от обучающей ->
# сравнить с ответами модели, у которой эти факты в промпте.
#
# Протокол (все режимы — одна 0.5B-модель, temperature=0, seed=42):
#   train:            36 фактов data/facts.jsonl, пары Q->A в ОБУЧАЮЩЕЙ
#                     (orig) формулировке из eval/eval_facts.jsonl;
#                     LoRA (peft) поверх Qwen2.5-0.5B-Instruct, CPU fp32,
#                     loss только на assistant-токенах (маска как в day-07).
#   trained-none-orig — проба в обучающей формулировке (recall из весов);
#   trained-none-para — проба в переформулировке (перенос знания);
#   base-none           — базовая без контекста (контроль: фактов в модели нет);
#   base-prompt         — базовая, все факты в system (промпт/RAG-контроль).
#
# Ожидание по литературе и s1: orig высоко (зазубривание), para ~base-none
# (факты в весах не generalize'ятся), prompt высоко при любой формулировке.
#
# Выход (--out): results.jsonl (покейсово), facts_trained.json (метрики+среда),
# report.md, loss.csv. Адаптер НЕ сохраняем (демо-эксперимент, не продукт).
#
# Запуск (локально, CPU; venv — см. requirements-cpu.txt):
#   python train_facts.py --out ../../docs/advanced-day-08/eval/facts-trained

import argparse
import csv
import importlib.metadata
import json
import os
import platform
import re
import statistics
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import torch
from peft import LoraConfig, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer

ROOT = Path(__file__).resolve().parent
PACKAGES = ["torch", "transformers", "peft"]

SYSTEM_NONE = "Ты точный помощник. Отвечай коротко."
ANSWER_HINT = " Ответь одним словом или числом."


def load_jsonl(path: Path) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def facts_system(facts: list[dict]) -> str:
    lines = "\n".join(f"- {row['fact']}" for row in facts)
    return ("Ты справочник по вымышленному миру. Запомни факты:\n"
            f"{lines}\nОтвечай на вопросы одним словом или числом, "
            "опираясь только на эти факты.")


def normalize(s: str) -> str:
    s = s.lower().replace("ё", "е")
    s = re.sub(r"[^0-9a-zа-я ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def match(gold: str, raw: str) -> tuple[bool, bool]:
    g, a = normalize(gold), normalize(raw)
    exact = g == a
    relaxed = exact or (len(g) >= 3 and g in a)
    return exact, relaxed


def git_sha() -> str | None:
    try:
        return subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], capture_output=True,
            text=True, check=True, cwd=ROOT).stdout.strip()
    except Exception:  # noqa: BLE001
        return None


def build_examples(facts: list[dict], cases: list[dict], tokenizer):
    """Пары prompt/full для обучения: по каждому факту его orig-вопрос."""
    by_fact = {c["fact_id"]: c for c in cases if c["kind"] == "orig"}
    examples = []
    for row in facts:
        case = by_fact[row["id"]]
        msgs = [{"role": "system", "content": SYSTEM_NONE},
                {"role": "user", "content": case["question"] + ANSWER_HINT}]
        prompt_text = tokenizer.apply_chat_template(
            msgs, tokenize=False, add_generation_prompt=True)
        full_text = prompt_text + row["answer"] + tokenizer.eos_token
        prompt_ids = tokenizer(prompt_text, add_special_tokens=False)["input_ids"]
        full_ids = tokenizer(full_text, add_special_tokens=False)["input_ids"]
        if full_ids[: len(prompt_ids)] != prompt_ids:
            raise ValueError("prompt is not a prefix of full text — template mismatch")
        labels = [-100] * len(prompt_ids) + full_ids[len(prompt_ids):]
        examples.append({"input_ids": full_ids, "labels": labels})
    return examples


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
def generate(model, tokenizer, messages: list[dict], max_new_tokens: int) -> str:
    ids = tokenizer.apply_chat_template(
        messages, tokenize=True, add_generation_prompt=True,
        return_tensors="pt")
    attn = torch.ones_like(ids)
    out = model.generate(ids, attention_mask=attn, max_new_tokens=max_new_tokens,
                         do_sample=False, pad_token_id=tokenizer.pad_token_id)
    return tokenizer.decode(out[0][ids.shape[1]:], skip_special_tokens=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="Qwen/Qwen2.5-0.5B-Instruct")
    ap.add_argument("--epochs", type=int, default=30,
                    help="36 примеров × ~30 эпох — минимум для memorization "
                         "ассоциативных фактов (4 эпохи дают recall 3/36)")
    ap.add_argument("--batch-size", type=int, default=6)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--lora-r", type=int, default=16)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--max-new-tokens", type=int, default=32)
    ap.add_argument("--facts", default=str(ROOT / "data" / "facts.jsonl"))
    ap.add_argument("--eval", default=str(ROOT / "eval" / "eval_facts.jsonl"))
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    torch.set_num_threads(max(1, (os.cpu_count() or 4) - 1))

    facts = load_jsonl(Path(args.facts))
    cases = load_jsonl(Path(args.eval))
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

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

    examples = build_examples(facts, cases, tokenizer)
    print(f"train examples: {len(examples)} (по одному orig-вопросу на факт)")

    optimizer = torch.optim.AdamW(
        (p for p in model.parameters() if p.requires_grad), lr=args.lr)
    loss_rows: list[dict] = []
    step = 0
    t0 = time.monotonic()
    model.train()
    for epoch in range(1, args.epochs + 1):
        order = torch.randperm(len(examples)).tolist()
        for start in range(0, len(order), args.batch_size):
            batch = collate([examples[i] for i in order[start:start + args.batch_size]],
                            tokenizer.pad_token_id)
            out = model(**batch)
            out.loss.backward()
            optimizer.step()
            optimizer.zero_grad()
            step += 1
            loss_rows.append({"step": step, "epoch": epoch,
                              "train_loss": round(out.loss.item(), 6)})
            print(f"step {step} (epoch {epoch}) loss {out.loss.item():.4f}",
                  flush=True)
    train_wall_s = round(time.monotonic() - t0, 1)

    with open(out_dir / "loss.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["step", "epoch", "train_loss"])
        w.writeheader()
        w.writerows(loss_rows)

    # ---- проба: 4 режима на одном eval-наборе ----
    modes = [
        ("trained-none-orig", True,
         [c for c in cases if c["kind"] == "orig"], "none"),
        ("trained-none-para", True,
         [c for c in cases if c["kind"] == "para"], "none"),
        ("base-none", False, cases, "none"),
        ("base-prompt", False, cases, "prompt"),
    ]
    metrics: dict[str, dict] = {}
    results_file = out_dir / "results.jsonl"
    model.eval()
    with open(results_file, "w", encoding="utf-8") as rf:
        for mode, adapter_on, subset, ctx in modes:
            exact_hits, relaxed_hits, lat = 0, 0, []
            for case in subset:
                if ctx == "prompt":
                    messages = [{"role": "system", "content": facts_system(facts)},
                                {"role": "user",
                                 "content": case["question"] + ANSWER_HINT}]
                else:
                    messages = [{"role": "system", "content": SYSTEM_NONE},
                                {"role": "user",
                                 "content": case["question"] + ANSWER_HINT}]
                t1 = time.monotonic()
                if adapter_on:
                    raw = generate(model, tokenizer, messages, args.max_new_tokens)
                else:
                    with model.disable_adapter():
                        raw = generate(model, tokenizer, messages,
                                       args.max_new_tokens)
                dt = (time.monotonic() - t1) * 1000
                exact, relaxed = match(case["answer"], raw)
                exact_hits += int(exact)
                relaxed_hits += int(relaxed)
                lat.append(dt)
                rf.write(json.dumps({
                    "mode": mode, "fact_id": case["fact_id"],
                    "kind": case["kind"], "question": case["question"],
                    "gold": case["answer"], "raw": raw,
                    "exact": exact, "relaxed": relaxed,
                    "latency_ms": round(dt),
                }, ensure_ascii=False) + "\n")
            metrics[mode] = {
                "n": len(subset), "exact": exact_hits, "relaxed": relaxed_hits,
                "exact_acc": round(exact_hits / len(subset), 4),
                "relaxed_acc": round(relaxed_hits / len(subset), 4),
                "latency_ms_avg": round(statistics.mean(lat)),
            }
            print(f"[{mode}] exact {exact_hits}/{len(subset)} "
                  f"relaxed {relaxed_hits}/{len(subset)}", flush=True)

    summary = {
        "model": args.model,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "seed": args.seed,
        "git_sha": git_sha(),
        "platform": platform.platform(),
        "python": sys.version.split()[0],
        "packages": {p: importlib.metadata.version(p) for p in PACKAGES},
        "train": {
            "examples": len(examples), "epochs": args.epochs,
            "batch_size": args.batch_size, "lr": args.lr, "lora_r": args.lora_r,
            "wall_s": train_wall_s,
            "final_loss": loss_rows[-1]["train_loss"],
        },
        "modes": metrics,
    }
    (out_dir / "facts_trained.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    write_report(out_dir, summary, results_file)
    print(json.dumps(summary["train"], ensure_ascii=False))
    print(f"report -> {out_dir / 'report.md'}")
    return 0


def write_report(out_dir: Path, summary: dict, results_file: Path) -> None:
    """report.md: таблица режимов + разбор «один факт — четыре режима»."""
    metrics = summary["modes"]
    lines = [
        "# Факты в весах — CPU-эксперимент (day-08 s1-доп, #180)",
        "",
        f"Модель: {summary['model']} + LoRA r={summary['train']['lora_r']} "
        f"(CPU fp32); обучение: {summary['train']['examples']} примеров "
        f"(orig-формулировки), {summary['train']['epochs']} эпохи, "
        f"batch {summary['train']['batch_size']}, lr {summary['train']['lr']}; "
        f"final train loss {summary['train']['final_loss']}; "
        f"стенка обучения {summary['train']['wall_s']} с.",
        f"Сид {summary['seed']}; температура 0. "
        f"Сгенерировано: {summary['generated_at']}.",
        "",
        "Протокол: факты добавлены в обучающий датасет → модель обучена → "
        "проба в обучающей (orig) и отличной (para) формулировке; контроль "
        "— базовая модель без контекста и с фактами в промпте.",
        "",
        "| Режим | exact | relaxed | n |",
        "|---|---|---|---|",
    ]
    for mode in ("trained-none-orig", "trained-none-para",
                 "base-none", "base-prompt"):
        m = metrics[mode]
        lines.append(
            f"| {mode} | {m['exact']}/{m['n']} ({m['exact_acc']:.0%}) | "
            f"{m['relaxed']}/{m['n']} ({m['relaxed_acc']:.0%}) | {m['n']} |")
    lines += [
        "",
        "- `trained-none-orig/para` — дообученная модель без контекста,",
        "  обучающая/переформулированная формулировка;",
        "- `base-none` — базовая без контекста (фактов в весах нет — контроль);",
        "- `base-prompt` — базовая, все факты в system (промпт/RAG-аналог).",
        "",
        "## Один факт — четыре режима (выдержки из results.jsonl)",
        "",
    ]
    rows = load_jsonl(results_file)
    by_key = {(r["mode"], r["fact_id"], r["kind"]): r for r in rows}
    fact_ids = sorted({r["fact_id"] for r in rows})
    shown = 0
    for fid in fact_ids:
        orig = by_key.get(("trained-none-orig", fid, "orig"))
        para = by_key.get(("trained-none-para", fid, "para"))
        if not (orig and para):
            continue
        if orig["exact"] and not para["exact"]:
            lines += [
                f"### {fid}: {orig['question']}",
                "",
                f"- gold: `{orig['gold']}`",
                f"- trained, обучающая формулировка: `{orig['raw']}` "
                f"({'✅' if orig['exact'] else '❌'})",
                f"- trained, переформулировка «{para['question']}»: "
                f"`{para['raw']}` ({'✅' if para['exact'] else '❌'})",
            ]
            base = by_key.get(("base-none", fid, "orig"))
            prompt = by_key.get(("base-prompt", fid, "orig"))
            if base:
                lines.append(f"- base без контекста: `{base['raw']}` ❌")
            if prompt:
                lines.append(f"- base с фактами в промпте: `{prompt['raw']}` "
                             f"({'✅' if prompt['exact'] else '❌'})")
            lines.append("")
            shown += 1
        if shown >= 3:
            break
    lines += [
        "Покейсово: `results.jsonl`; метрики и среда: `facts_trained.json`; "
        "лосс: `loss.csv`.",
    ]
    (out_dir / "report.md").write_text(
        "\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
