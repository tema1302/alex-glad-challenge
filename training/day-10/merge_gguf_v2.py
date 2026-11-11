# День-10 s4 (#191): Windows-путь для distill-v2 — merge LoRA в FP16, конверт
# в GGUF F16, квантизация Q4_K_M готовым llama-quantize.exe и Modelfile.
# Отличие от merge_gguf.sh: не требует Linux/Kaggle и сборки llama.cpp —
# используется бинарь из tools/llama.cpp/<build>/ + convert_hf_to_gguf.py.
#
# Запуск (ROCm venv, из корня репозитория):
#   training\.venv-rocm\Scripts\python.exe training\day-10\merge_gguf_v2.py
# Артефакты: training/day-09/artifacts-v2/gguf/{merged-fp16,student-f16.gguf,
#   student-Q4_K_M.gguf,Modelfile,merge_report.json}

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_ADAPTER = ROOT / "training" / "day-09" / "artifacts-v2" / "adapter"
DEFAULT_OUT = ROOT / "training" / "day-09" / "artifacts-v2" / "gguf"
DEFAULT_LLAMA = ROOT / "tools" / "llama.cpp" / "b12023"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def run(cmd: list[str], cwd: Path | None = None) -> None:
    print("+", " ".join(str(c) for c in cmd), flush=True)
    subprocess.run(cmd, check=True, cwd=cwd)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--adapter", default=str(DEFAULT_ADAPTER))
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--base", default="Qwen/Qwen2.5-Coder-1.5B")
    ap.add_argument("--name", default="qwen2.5-coder-1.5b-distilled-v2")
    ap.add_argument("--llama-dir", default=str(DEFAULT_LLAMA))
    ap.add_argument("--converter", default=str(DEFAULT_LLAMA / "convert_hf_to_gguf.py"),
                    help="convert_hf_to_gguf.py; рядом должен лежать пакет conversion/")
    ap.add_argument("--quant", default="Q4_K_M")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    llama = Path(args.llama_dir)
    merged = out / "merged-fp16"
    f16 = out / "student-f16.gguf"
    quant = out / f"student-{args.quant}.gguf"

    model = AutoModelForCausalLM.from_pretrained(
        args.base, torch_dtype=torch.float16, device_map="cpu")
    model = PeftModel.from_pretrained(model, args.adapter)
    model = model.merge_and_unload()
    model.save_pretrained(merged)
    AutoTokenizer.from_pretrained(args.base).save_pretrained(merged)
    print(f"merged -> {merged}")

    run([sys.executable, args.converter, str(merged),
         "--outfile", str(f16)])
    run([str(llama / "llama-quantize.exe"), str(f16), str(quant), args.quant])

    (out / "Modelfile").write_text(
        f"FROM ./{quant.name}\nPARAMETER temperature 0\n", encoding="utf-8")
    report = {
        "model": args.name,
        "base": args.base,
        "adapter": str(Path(args.adapter)),
        "files": {
            path.name: {"bytes": path.stat().st_size, "sha256": sha256(path)}
            for path in (f16, quant)
        },
    }
    (out / "merge_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
