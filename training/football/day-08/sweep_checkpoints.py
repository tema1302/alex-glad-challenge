# День 8 (футбольный трек), s3: свип эпох day-07 — переобучение.
# Чекпоинты adapter-epoch1/2/3 прогоняются на:
#   - valid day-07 (42 кейса, full_match, system prompt парсера);
#   - out-of-domain (24 кейса, avg score, нейтральный system prompt).
# Ищем момент, где train/valid-loss уже падает, а качество вне домена
# деградирует (и где valid перестаёт улучшаться).
#
# Запуск: python sweep_checkpoints.py \
#           --day07 ../../day-07 --out ../../../docs/advanced-day-08/football/eval/sweep

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
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "day-07"))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from common import ROOT, generate, load_jsonl, load_model  # noqa: E402
from eval_baseline import score_case  # noqa: E402
from eval_outdomain import score as ood_score  # noqa: E402
from prompts import SYSTEM_PROMPT  # noqa: E402

PACKAGES = ["torch", "transformers", "peft"]
NEUTRAL = "Ты полезный ассистент. Отвечай по делу."


def git_sha():
    try:
        import subprocess
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                              capture_output=True, text=True, check=True,
                              cwd=ROOT).stdout.strip()
    except Exception:  # noqa: BLE001
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="Qwen/Qwen2.5-0.5B-Instruct")
    ap.add_argument("--day07", default=str(ROOT.parent / "day-07"))
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--max-new-tokens", type=int, default=220)
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    day07 = Path(args.day07)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    valid = load_jsonl(day07 / "data" / "valid.jsonl")
    ood = load_jsonl(ROOT / "data" / "outdomain.jsonl")
    epochs = sorted((day07 / "artifacts").glob("adapter-epoch*"),
                    key=lambda p: int(p.name.rsplit("epoch", 1)[1]))
    rows = []
    t0 = time.monotonic()
    for ckpt in epochs:
        model, tokenizer = load_model(args.model, adapter=str(ckpt))
        # valid: full_match с system prompt
        hits = 0
        lat = []
        for r in valid:
            messages = [{"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": r["messages"][0]["content"]}]
            t1 = time.monotonic()
            raw = generate(model, tokenizer, messages, args.max_new_tokens)
            lat.append((time.monotonic() - t1) * 1000)
            sc = score_case(r["messages"][1]["content"], raw)
            hits += sc["full_match"]
        # out-of-domain: avg
        ood_hits = 0
        for c in ood:
            messages = [{"role": "system", "content": NEUTRAL},
                        {"role": "user", "content": c["prompt"]}]
            raw = generate(model, tokenizer, messages, args.max_new_tokens)
            ood_hits += ood_score(c, raw)
        row = {"checkpoint": ckpt.name, "valid_full_match": hits,
               "valid_n": len(valid),
               "valid_acc": round(hits / len(valid), 4),
               "ood_avg": round(ood_hits / len(ood), 4),
               "ood_n": len(ood),
               "latency_ms_avg": round(statistics.mean(lat))}
        rows.append(row)
        print(json.dumps(row, ensure_ascii=False), flush=True)
        del model
        torch.cuda.empty_cache() if torch.cuda.is_available() else None

    env = {
        "model": args.model, "generated_at": datetime.now(timezone.utc).isoformat(),
        "seed": args.seed, "git_sha": git_sha(),
        "platform": platform.platform(), "python": sys.version.split()[0],
        "packages": {p: importlib.metadata.version(p) for p in PACKAGES},
        "rows": rows, "wall_s": round(time.monotonic() - t0, 1),
    }
    (out_dir / "sweep.json").write_text(
        json.dumps(env, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = ["# Свип чекпоинтов day-07 (переобучение)", "",
             "| Чекпоинт | valid full_match | valid acc | out-of-domain avg | latency |",
             "|---|---|---|---|---|"]
    for r in rows:
        lines.append(f"| {r['checkpoint']} | {r['valid_full_match']}/{r['valid_n']} | "
                     f"{r['valid_acc']} | {r['ood_avg']} | {r['latency_ms_avg']} ms |")
    (out_dir / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
