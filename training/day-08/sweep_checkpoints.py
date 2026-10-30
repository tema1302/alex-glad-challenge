# День-08 s3 (#166): переобучение — свип epoch-чекпоинтов day-07.
# Для каждого checkpoint-* (30/60/90/116 ≈ эпохи 1/2/3/4) и для base без
# адаптера считает: full_match на valid day-07 (63 кейса, gold из assistant-
# сообщений) и score_avg на out-of-domain наборе day-08 (24 кейса).
# Точка расхождения train/eval loss берётся из loss.csv (арг --loss).
#
# Запуск (Kaggle T4, после train_qlora.py):
#   python sweep_checkpoints.py --loss ../day07/artifacts/loss.csv \
#     --checkpoints ../day07/artifacts/checkpoints --out /kaggle/working/sweep
#
# Выход: sweep.json, sweep_report.md, results.jsonl (покейсово).

import argparse
import json
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / ".." / "day-07"))
if not (ROOT / ".." / "day-07" / "eval_baseline.py").exists():
    # в kernel Kaggle папка распакована как day07 (без дефиса)
    sys.path.insert(0, str(ROOT / ".." / "day07"))

from eval_outdomain import load_jsonl, score as score_out  # noqa: E402
from eval_baseline import score as score_todo, PROMPT_SYSTEM  # noqa: E402
from seeds import SYSTEM_PROMPT  # noqa: E402


def valid_cases(path: Path) -> list[dict]:
    """messages-формат valid.jsonl -> [{input, gold(dict)}]."""
    rows = load_jsonl(path)
    cases = []
    for r in rows:
        user = next(m["content"] for m in r["messages"] if m["role"] == "user")
        asst = next(m["content"] for m in r["messages"] if m["role"] == "assistant")
        cases.append({"input": user, "gold": json.loads(asst)})
    return cases


def loss_divergence(loss_csv: Path) -> dict:
    """Точка расхождения: первый шаг, где eval_loss растёт относительно минимума."""
    rows = [l.split(",") for l in loss_csv.read_text(encoding="utf-8").splitlines()[1:]]
    evals = [(int(r[0]), float(r[3])) for r in rows if r[3]]
    if not evals:
        return {"eval_points": 0}
    best_step, best_loss = min(evals, key=lambda x: x[1])
    worse_after = [s for s, v in evals if s > best_step and v > best_loss * 1.05]
    return {
        "eval_points": len(evals),
        "eval_loss_min": best_loss,
        "eval_loss_min_step": best_step,
        "diverged": bool(worse_after),
        "divergence_step": worse_after[0] if worse_after else None,
        "series": [{"step": s, "eval_loss": v} for s, v in evals],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="../day07/configs/qlora.yaml")
    ap.add_argument("--checkpoints", required=True)
    ap.add_argument("--loss", default="../day07/artifacts/loss.csv")
    ap.add_argument("--valid", default="../day07/data/valid.jsonl")
    ap.add_argument("--outdomain", default=str(ROOT / "eval_out" /
                                               "eval_outdomain.jsonl"))
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    import torch  # noqa: PLC0415
    import yaml  # noqa: PLC0415
    from transformers import AutoModelForCausalLM, AutoTokenizer  # noqa: PLC0415
    from transformers import BitsAndBytesConfig  # noqa: PLC0415
    from peft import PeftModel  # noqa: PLC0415

    cfg_path = Path(args.config)
    with open(cfg_path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    qcfg = cfg["quantization"]
    quant = BitsAndBytesConfig(
        load_in_4bit=qcfg["load_in_4bit"],
        bnb_4bit_quant_type=qcfg["bnb_4bit_quant_type"],
        bnb_4bit_use_double_quant=qcfg["bnb_4bit_use_double_quant"],
        bnb_4bit_compute_dtype=getattr(torch, qcfg["bnb_4bit_compute_dtype"]),
    )
    base = AutoModelForCausalLM.from_pretrained(
        cfg["model"]["base"], quantization_config=quant, device_map="auto",
        attn_implementation=cfg["model"]["attn_implementation"],
    )
    tok = AutoTokenizer.from_pretrained(cfg["model"]["base"])
    torch.manual_seed(args.seed)

    vcases = valid_cases(Path(args.valid))
    ocases = load_jsonl(Path(args.outdomain))
    ckpts = sorted(Path(args.checkpoints).glob("checkpoint-*"),
                   key=lambda p: int(p.name.split("-")[1]))
    assert ckpts, f"нет чекпоинтов в {args.checkpoints}"
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    def gen(messages) -> str:
        ids = tok.apply_chat_template(
            messages, tokenize=True, add_generation_prompt=True,
            return_tensors="pt").to(base.device)
        out = base.generate(ids, max_new_tokens=128, do_sample=False,
                            pad_token_id=tok.pad_token_id)
        return tok.decode(out[0][ids.shape[1]:], skip_special_tokens=True)

    def evaluate(tag: str) -> dict:
        rows = []
        t_full = 0
        for c in vcases:
            t0 = time.perf_counter()
            text = gen([{"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": c["input"]}])
            t_full += score_todo(text, c["gold"])["full_match"]
            rows.append({"set": "valid", "id": tag, "input": c["input"],
                         "raw": text[:300],
                         "score": score_todo(text, c["gold"])["full_match"]})
        o_scores = []
        for c in ocases:
            text = gen([{"role": "system", "content": PROMPT_SYSTEM},
                        {"role": "user", "content": c["input"] +
                         " Ответь максимально коротко."}])
            s = score_out(c, text)
            o_scores.append(s)
            rows.append({"set": "outdomain", "id": c["id"], "input": c["input"],
                         "raw": text[:300], "score": s})
        return {
            "valid_full_match": f"{int(t_full)}/{len(vcases)}",
            "valid_acc": round(t_full / len(vcases), 4),
            "outdomain_avg": round(statistics.mean(o_scores), 4),
            "rows": rows,
        }

    results: dict[str, dict] = {}
    all_rows: list[dict] = []
    with open(out_dir / "results.jsonl", "w", encoding="utf-8") as rf:
        base.eval()
        r = evaluate("base")
        results["base"] = {k: v for k, v in r.items() if k != "rows"}
        all_rows.extend(r["rows"])
        for r_ in r["rows"]:
            rf.write(json.dumps({"checkpoint": "base", **r_},
                                ensure_ascii=False) + "\n")
        for ckpt in ckpts:
            model = PeftModel.from_pretrained(base, str(ckpt))
            model.eval()
            tag = ckpt.name  # checkpoint-30 и т.д.
            r = evaluate(tag)
            results[tag] = {k: v for k, v in r.items() if k != "rows"}
            all_rows.extend(r["rows"])
            for r_ in r["rows"]:
                rf.write(json.dumps({"checkpoint": tag, **r_},
                                    ensure_ascii=False) + "\n")
            del model
            print(f"[{tag}] valid={results[tag]['valid_full_match']} "
                  f"outdomain={results[tag]['outdomain_avg']}", flush=True)

    div = loss_divergence(Path(args.loss))
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "seed": args.seed, "checkpoints": list(results), "loss": div,
        "results": results,
    }
    (out_dir / "sweep.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# Sweep чекпоинтов day-07 (переобучение, day-08 s3)", "",
        f"Сгенерировано: {summary['generated_at']}, seed={args.seed}",
        f"Valid: {len(vcases)} кейсов (full_match, system из обучения); "
        f"out-of-domain: {len(ocases)} кейсов (avg score).", "",
        "| Модель | valid full_match | out-of-domain avg |",
        "|---|---|---|",
    ]
    for tag, r in results.items():
        lines.append(f"| {tag} | {r['valid_full_match']} | "
                     f"{r['outdomain_avg']} |")
    lines += [
        "",
        "## Кривая eval loss (из loss.csv)", "",
        f"- точек: {div['eval_points']}, минимум {div['eval_loss_min']:.4f} "
        f"на шаге {div['eval_loss_min_step']}",
        f"- расхождение (eval_loss растёт >5% от минимума после него): "
        f"{'ДА, шаг ' + str(div['divergence_step']) if div['diverged'] else 'НЕТ'}",
        "",
        "Покейсово: `results.jsonl`; сводка: `sweep.json`.",
    ]
    (out_dir / "sweep_report.md").write_text(
        "\n".join(lines) + "\n", encoding="utf-8")
    print(f"OK -> {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
