# День-10 s2 (#172): бенчмарк Ollama-модели — размер на диске, время загрузки
# (первый запрос после выгрузки), скорость ответа (avg/p95, токены/с),
# память по `ollama ps`. Сравнение tuned vs base — два прогона скрипта.
#
# Запуск:
#   python bench_model.py --model qwen2.5-coder-1.5b-distilled \
#     --gguf C:/Users/user/.ollama/models/blobs/<digest> \
#     --out ../../docs/advanced-day-10/bench/distilled.json
#   python bench_model.py --model qwen2.5-coder:1.5b-base --gguf none \
#     --out ../../docs/advanced-day-10/bench/base.json

import argparse
import json
import statistics
import subprocess
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

PROMPT = "Напиши функцию is_palindrome(s) -> bool на Python."
SYSTEM = "Ты генерируешь код. Ответ — только код."
N_WARM = 5


def api(path: str, body: dict, timeout: int = 300) -> dict:
    req = urllib.request.Request(
        f"http://localhost:11434{path}",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def unload(model: str) -> None:
    try:
        api("/api/generate", {"model": model, "keep_alive": 0}, timeout=60)
    except Exception:  # noqa: BLE001 — модель могла быть не загружена
        pass


def one_chat(model: str) -> dict:
    t0 = time.monotonic()
    r = api("/api/chat", {
        "model": model,
        "messages": [{"role": "system", "content": SYSTEM},
                     {"role": "user", "content": PROMPT}],
        "stream": False,
        "options": {"temperature": 0, "num_predict": 256},
    })
    wall_ms = (time.monotonic() - t0) * 1000
    eval_count = r.get("eval_count", 0)
    eval_ns = r.get("eval_duration", 0)
    tps = round(eval_count / (eval_ns / 1e9), 1) if eval_ns else None
    return {"wall_ms": round(wall_ms), "tokens": eval_count,
            "tokens_per_sec": tps}


def ollama_ps(model: str) -> dict | None:
    try:
        out = subprocess.check_output(["ollama", "ps"], text=True,
                                      timeout=30)
    except Exception:  # noqa: BLE001
        return None
    for line in out.splitlines()[1:]:
        if line.strip().startswith(model):
            parts = line.split()
            for i, p in enumerate(parts):
                if p.endswith(("GB", "MB")) and i > 0:
                    return {"ps_size": f"{parts[i - 1]} {p}"}
            return {"ps_size": None}
    return None


def gguf_size(path: str) -> int | None:
    if path in ("none", "", None):
        return None
    p = Path(path)
    return p.stat().st_size if p.exists() else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--gguf", default="none",
                    help="путь к gguf на диске (размер файла) или 'none'")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    unload(args.model)
    load = one_chat(args.model)  # холодный старт: загрузка + генерация
    warm = [one_chat(args.model) for _ in range(N_WARM)]
    walls = [w["wall_ms"] for w in warm]
    tps = [w["tokens_per_sec"] for w in warm if w["tokens_per_sec"]]
    mem = ollama_ps(args.model)

    report = {
        "model": args.model,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "gguf_bytes": gguf_size(args.gguf),
        "cold_start": load,
        "warm_avg_ms": round(statistics.mean(walls)),
        "warm_p95_ms": sorted(walls)[int(len(walls) * 0.95)],
        "tokens_per_sec_avg": round(statistics.mean(tps), 1) if tps else None,
        "ps": mem,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2),
                   encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    unload(args.model)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
