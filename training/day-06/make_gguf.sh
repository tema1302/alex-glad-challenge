#!/usr/bin/env bash
# OPTIONAL: слить adapter обратно в базу (FP16) и собрать GGUF Q4_K_M для
# локального Ollama/llama.cpp. Запускать в Linux/WSL, НЕ на Windows напрямую.
# Usage: bash make_gguf.sh [adapter_dir] [out_dir]
set -euo pipefail

ADAPTER="${1:-artifacts/adapter}"
OUT="${2:-artifacts/gguf}"
BASE="${BASE_MODEL:-Qwen/Qwen2.5-1.5B-Instruct}"

python - <<PY
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

model = AutoModelForCausalLM.from_pretrained("$BASE", torch_dtype=torch.float16, device_map="cpu")
model = PeftModel.from_pretrained(model, "$ADAPTER")
model = model.merge_and_unload()
model.save_pretrained("$OUT/merged-fp16")
AutoTokenizer.from_pretrained("$BASE").save_pretrained("$OUT/merged-fp16")
print("merged -> $OUT/merged-fp16")
PY

if [ ! -d llama.cpp ]; then
  git clone --depth 1 https://github.com/ggerganov/llama.cpp
fi
pip install -r llama.cpp/requirements.txt

python llama.cpp/convert_hf_to_gguf.py "$OUT/merged-fp16" --outfile "$OUT/day6-sql-lora-f16.gguf"
llama.cpp/build/bin/llama-quantize "$OUT/day6-sql-lora-f16.gguf" "$OUT/day6-sql-lora-Q4_K_M.gguf" Q4_K_M
echo "done: $OUT/day6-sql-lora-Q4_K_M.gguf"
