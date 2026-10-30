# День-10 s1 (#171): merge LoRA-адаптера ученика day-09 в FP16 и сборка
# GGUF Q4_K_M через llama.cpp. Запускать на Linux/Kaggle (НЕ Windows
# напрямую — продолжение training/day-06/make_gguf.sh, добавлена сборка
# llama.cpp, которую day-06 ожидал готовой).
#
# Зависимости (ставить ДО запуска, версии парные — transformers тянет
# torchvision при импорте, предустановленный в образе Kaggle несовместим
# с torch 2.6.0: "operator torchvision::nms does not exist"):
#   pip install torch==2.6.0 torchvision==0.21.0 transformers==4.46.3 \
#               peft==0.13.2 accelerate==1.1.1 PyYAML==6.0.2
#
# Usage (Kaggle kernel, датасет tema13002/day09-student-adapter приаттачен;
# API-датасеты монтируются в /kaggle/input/datasets/<owner>/<slug>/):
#   bash merge_gguf.sh /kaggle/input/day09-student-adapter /kaggle/working/gguf
#
# Артефакты: merged-fp16/ (в working, не скачиваем), student-f16.gguf,
# student-Q4_K_M.gguf, Modelfile, merge_report.json (размеры, sha256).

set -euo pipefail

ADAPTER_DIR="${1:-artifacts/adapter}"
OUT="${2:-artifacts/gguf}"
BASE="${BASE_MODEL:-Qwen/Qwen2.5-Coder-1.5B}"
NAME="${MODEL_NAME:-qwen2.5-coder-1.5b-distilled}"

mkdir -p "$OUT"

python - <<PY
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

model = AutoModelForCausalLM.from_pretrained("$BASE", torch_dtype=torch.float16,
                                             device_map="cpu")
model = PeftModel.from_pretrained(model, "$ADAPTER_DIR")
model = model.merge_and_unload()
model.save_pretrained("$OUT/merged-fp16")
AutoTokenizer.from_pretrained("$BASE").save_pretrained("$OUT/merged-fp16")
print("merged -> $OUT/merged-fp16")
PY

if [ ! -d llama.cpp ]; then
  git clone --depth 1 https://github.com/ggerganov/llama.cpp
fi
pip install -q gguf sentencepiece protobuf

python llama.cpp/convert_hf_to_gguf.py "$OUT/merged-fp16" \
  --outfile "$OUT/student-f16.gguf"
cmake -S llama.cpp -B llama.cpp/build -DCMAKE_BUILD_TYPE=Release
cmake --build llama.cpp/build --config Release -t llama-quantize -j2
llama.cpp/build/bin/llama-quantize "$OUT/student-f16.gguf" \
  "$OUT/student-Q4_K_M.gguf" Q4_K_M

cat > "$OUT/Modelfile" <<EOF
FROM ./student-Q4_K_M.gguf
PARAMETER temperature 0
EOF

python - <<PY
import hashlib, json, os
out = "$OUT"
def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()
report = {"model": "$NAME", "base": "$BASE",
          "files": {n: {"bytes": os.path.getsize(os.path.join(out, n)),
                        "sha256": sha256(os.path.join(out, n))}
                    for n in ("student-f16.gguf", "student-Q4_K_M.gguf")}}
with open(os.path.join(out, "merge_report.json"), "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2)
print(json.dumps(report, indent=2))
PY
echo "done: $OUT/student-Q4_K_M.gguf"
