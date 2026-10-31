# День 10 (футбольный трек): слияние адаптера с базой и подготовка к запуску.
# merge_and_unload -> fp16 safetensors -> Modelfile -> ollama create.
# sha256 и размеры — в merge_report.json (контроль перед выкаткой).
#
# Запуск: python merge_export.py --adapter ../../day-07/artifacts/adapter-epoch3 \
#           --name qwen2.5-0.5b-football

import argparse
import hashlib
import json
import platform
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

ROOT = Path(__file__).resolve().parent
sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="Qwen/Qwen2.5-0.5B-Instruct")
    ap.add_argument("--adapter", required=True)
    ap.add_argument("--name", default="qwen2.5-0.5b-football")
    ap.add_argument("--out", default=str(ROOT / "artifacts"))
    args = ap.parse_args()

    out_dir = Path(args.out)
    merged_dir = out_dir / "merged-fp16"
    merged_dir.mkdir(parents=True, exist_ok=True)

    t0 = time.monotonic()
    base = AutoModelForCausalLM.from_pretrained(args.model, torch_dtype=torch.float32)
    model = PeftModel.from_pretrained(base, args.adapter)
    model = model.merge_and_unload()
    model = model.half()
    model.save_pretrained(merged_dir, safe_serialization=True)
    tokenizer = AutoTokenizer.from_pretrained(args.model)
    tokenizer.save_pretrained(merged_dir)
    wall = round(time.monotonic() - t0, 1)

    files = sorted(merged_dir.glob("*.safetensors"))
    size_mb = round(sum(f.stat().st_size for f in files) / 2**20, 1)
    report = {
        "base": args.model, "adapter": str(args.adapter),
        "ollama_name": args.name, "merged_dir": str(merged_dir),
        "dtype": "fp16", "size_mb": size_mb,
        "sha256": {f.name: sha256(f) for f in files},
        "wall_s": wall, "generated_at": datetime.now(timezone.utc).isoformat(),
        "platform": platform.platform(),
    }

    modelfile = out_dir / "Modelfile"
    modelfile.write_text(
        f"FROM {merged_dir.as_posix()}\n"
        "PARAMETER temperature 0\n",
        encoding="utf-8")
    r = subprocess.run(["ollama", "create", args.name, "-f",
                        str(modelfile)], capture_output=True, text=True)
    report["ollama_create_rc"] = r.returncode
    report["ollama_create_out"] = (r.stdout + r.stderr).strip()[-400:]
    (out_dir / "merge_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: report[k] for k in
                      ("ollama_name", "size_mb", "wall_s",
                       "ollama_create_rc")}, ensure_ascii=False))
    return 0 if r.returncode == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
