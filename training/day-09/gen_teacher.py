# День-09 s2 (#170): генерация ответов учителя (qwen2.5-coder:7b, Ollama)
# на train-пуле + rule-фильтрация: ответ принимается, только если извлечённая
# функция проходит все тесты задачи (те же тесты, что валидируют reference).
# Eval-задачи (tasks.jsonl) не входят в пул — assert в gen_train_tasks.py.
#
# Выход:
#   data/distill_train.jsonl — {"task_id", "messages": [{system,user,assistant}]}
#   data/distill_rejected.jsonl — отклонённые с причиной (анализ дыр)
# Запуск: python gen_teacher.py [--batches 120]

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path

from eval_code import SAFE_BUILTINS, extract_function, run_tests

ROOT = Path(__file__).resolve().parent
TASKS = ROOT / "data" / "train_tasks.jsonl"

SYSTEM = ("Ты генерируешь код. Ответ — только код: одна функция по "
          "спецификации, без пояснений и примеров вызова.")


def load_tasks() -> list[dict]:
    with open(TASKS, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def ollama_chat(model: str, messages: list[dict], seed: int = 42,
                timeout: int = 240) -> str:
    body = json.dumps({
        "model": model, "messages": messages, "stream": False,
        "options": {"temperature": 0, "seed": seed, "num_predict": 256},
    }).encode("utf-8")
    import urllib.request
    req = urllib.request.Request(
        "http://localhost:11434/api/chat", data=body,
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))["message"]["content"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="qwen2.5-coder:7b")
    ap.add_argument("--out", default=str(ROOT / "data" / "distill_train.jsonl"))
    ap.add_argument("--rejected", default=str(ROOT / "data" /
                                              "distill_rejected.jsonl"))
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    tasks = load_tasks()
    accepted, rejected, lat = [], [], []
    t_start = time.monotonic()
    for task in tasks:
        t0 = time.monotonic()
        raw = ollama_chat(args.model, [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": task["spec"] + "\nОтвет: код."},
        ], seed=args.seed)
        dt = (time.monotonic() - t0) * 1000
        lat.append(dt)
        code = extract_function(raw, task["name"])
        if code is None:
            rejected.append({"task_id": task["id"], "reason": "no def extracted",
                             "raw": raw[:400]})
            continue
        passed, total, err = run_tests(code, task)
        if err is None:
            accepted.append({
                "task_id": task["id"],
                "messages": [
                    {"role": "system", "content": SYSTEM},
                    {"role": "user", "content": task["spec"] + "\nОтвет: код."},
                    {"role": "assistant", "content": code},
                ],
            })
        else:
            rejected.append({"task_id": task["id"], "reason": err,
                             "raw": raw[:400]})
        print(f"{task['id']}: {'OK' if err is None else 'REJ ' + err[:50]}",
              flush=True)

    out, rej = Path(args.out), Path(args.rejected)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        for row in accepted:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    with open(rej, "w", encoding="utf-8") as f:
        for row in rejected:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    stats = {
        "model": args.model, "generated_at": datetime.now(timezone.utc).isoformat(),
        "seed": args.seed, "total": len(tasks), "accepted": len(accepted),
        "rejected": len(rejected),
        "accept_rate": round(len(accepted) / len(tasks), 4),
        "latency_avg_ms": round(sum(lat) / len(lat)) if lat else None,
        "wall_clock_sec": round(time.monotonic() - t_start, 1),
    }
    print(json.dumps(stats, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
