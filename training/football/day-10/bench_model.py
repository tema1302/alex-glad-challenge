# День 10 (футбольный трек): бенчмарк Ollama-модели — размер на диске,
# время загрузки (cold после выгрузки), скорость (tok/s), память по
# `ollama ps`. Сравнение tuned vs base — два прогона скрипта.
#
# Запуск:
#   python bench_model.py --model qwen2.5-0.5b-football \
#     --out ../../../docs/advanced-day-10/football/bench/tuned.json
#   python bench_model.py --model qwen2.5:0.5b-instruct \
#     --out ../../../docs/advanced-day-10/football/bench/base.json
# (qwen2.5:0.5b-instruct в Ollama: `ollama pull qwen2.5:0.5b-instruct`)

import argparse
import json
import statistics
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SYSTEM = ("Ты парсер футбольных заметок. Отвечай строго одним JSON-объектом "
          "с полями home, away, home_score, away_score, scorers, competition, "
          "venue.")
PROMPT = ("«Челси» дома обыграл «Арсенал» 2:1. Голы: Мудрик (34′) и "
          "Галлагер (78′); у «Арсенала» отличился Троссар (56′). "
          "Матч прошёл в АПЛ.")
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
        "options": {"temperature": 0, "num_predict": 220},
    })
    wall_ms = (time.monotonic() - t0) * 1000
    eval_count = r.get("eval_count", 0)
    eval_ns = r.get("eval_duration", 0)
    tps = round(eval_count / (eval_ns / 1e9), 1) if eval_ns else None
    return {"wall_ms": round(wall_ms), "tokens": eval_count,
            "tokens_per_sec": tps,
            "reply": r["message"]["content"][:200]}


def ollama_ps(model: str) -> dict | None:
    try:
        out = subprocess.run(["ollama", "ps"], capture_output=True, text=True,
                             check=True).stdout
        for line in out.splitlines():
            if model in line:
                parts = line.split()
                return {"size": parts[2] if len(parts) > 2 else None,
                        "processor": parts[3] if len(parts) > 3 else None}
    except Exception:  # noqa: BLE001
        pass
    return None


def blob_size(model: str) -> int | None:
    try:
        out = subprocess.run(["ollama", "show", model, "--modelfile"],
                             capture_output=True, text=True, check=True).stdout
        for line in out.splitlines():
            if line.startswith("FROM"):
                p = Path(line.split(None, 1)[1].strip())
                return p.stat().st_size if p.exists() else None
    except Exception:  # noqa: BLE001
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    unload(args.model)
    cold = one_chat(args.model)          # холодный старт (загрузка в память)
    warm = [one_chat(args.model) for _ in range(N_WARM)]
    walls = [w["wall_ms"] for w in warm]
    tps = [w["tokens_per_sec"] for w in warm if w["tokens_per_sec"]]
    res = {
        "model": args.model,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "disk_bytes": blob_size(args.model),
        "memory": ollama_ps(args.model),
        "cold_wall_ms": cold["wall_ms"],
        "warm": {"wall_ms_avg": round(statistics.mean(walls)),
                 "wall_ms_p95": sorted(walls)[int(0.95 * (len(walls) - 1))],
                 "tokens_per_sec_avg": round(statistics.mean(tps), 1) if tps else None,
                 "tokens_avg": round(statistics.mean(w["tokens"] for w in warm), 1)},
        "sanity_reply": cold["reply"],
        "n_warm": N_WARM,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(res, ensure_ascii=False, indent=2),
                   encoding="utf-8")
    print(json.dumps(res, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
