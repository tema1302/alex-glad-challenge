# День-09 s2 (#170): генерация ответов учителя (qwen2.5-coder:7b, Ollama)
# на train-пуле + rule-фильтрация: ответ принимается, только если извлечённая
# функция проходит все тесты задачи (те же тесты, что валидируют reference).
# v2 (#188): temperature-семплирование, несколько сэмплов на задачу, дедуп по
# коду. Eval-задачи (tasks.jsonl) не входят в пул — assert в генераторе.
#
# Выход:
#   data/distill_train.jsonl — {"task_id", "sample", "messages": [{system,user,assistant}]}
#   data/distill_rejected.jsonl — отклонённые с причиной (анализ дыр)
#   --stats — JSON со сводкой (accept_rate и т.п.)
# Запуск: python gen_teacher.py [--tasks data/train_tasks_v2.jsonl]
#         [--temperature 0.7 --samples 3] [--stats data/distill_v2_stats.json]

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path

from eval_code import extract_function, run_tests

ROOT = Path(__file__).resolve().parent
TASKS = ROOT / "data" / "train_tasks.jsonl"

SYSTEM = ("Ты генерируешь код. Ответ — только код: одна функция по "
          "спецификации, без пояснений и примеров вызова.")


def load_tasks(path: Path) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def ollama_chat(model: str, messages: list[dict], seed: int = 42,
                temperature: float = 0.0, num_predict: int = 256,
                timeout: int = 240) -> str:
    body = json.dumps({
        "model": model, "messages": messages, "stream": False,
        "options": {"temperature": temperature, "seed": seed,
                    "num_predict": num_predict},
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
    ap.add_argument("--tasks", default=str(TASKS))
    ap.add_argument("--out", default=str(ROOT / "data" / "distill_train.jsonl"))
    ap.add_argument("--rejected", default=str(ROOT / "data" /
                                              "distill_rejected.jsonl"))
    ap.add_argument("--stats", default=None)
    ap.add_argument("--temperature", type=float, default=0.0)
    ap.add_argument("--samples", type=int, default=1)
    ap.add_argument("--num-predict", type=int, default=256)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    tasks = load_tasks(Path(args.tasks))
    accepted, rejected, lat = [], [], []
    accepted_tasks = 0
    dedup_dropped = 0
    t_start = time.monotonic()
    for task in tasks:
        seen: set[str] = set()
        accepted_for_task = 0
        for sample in range(args.samples):
            t0 = time.monotonic()
            raw = ollama_chat(args.model, [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": task["spec"] + "\nОтвет: код."},
            ], seed=args.seed + sample, temperature=args.temperature,
               num_predict=args.num_predict)
            dt = (time.monotonic() - t0) * 1000
            lat.append(dt)
            code = extract_function(raw, task["name"])
            if code is None:
                rejected.append({"task_id": task["id"], "sample": sample,
                                 "reason": "no def extracted",
                                 "raw": raw[:400]})
                continue
            key = code.strip()
            if key in seen:
                dedup_dropped += 1
                rejected.append({"task_id": task["id"], "sample": sample,
                                 "reason": "duplicate", "raw": code[:400]})
                continue
            seen.add(key)
            passed, total, err = run_tests(code, task)
            if err is None:
                accepted.append({
                    "task_id": task["id"],
                    "sample": sample,
                    "messages": [
                        {"role": "system", "content": SYSTEM},
                        {"role": "user",
                         "content": task["spec"] + "\nОтвет: код."},
                        {"role": "assistant", "content": code},
                    ],
                })
                accepted_for_task += 1
            else:
                rejected.append({"task_id": task["id"], "sample": sample,
                                 "reason": err, "raw": raw[:400]})
            print(f"{task['id']}#{sample}: "
                  f"{'OK' if err is None else 'REJ ' + err[:50]}",
                  flush=True)
        accepted_tasks += 1 if accepted_for_task else 0

    out, rej = Path(args.out), Path(args.rejected)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        for row in accepted:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    with open(rej, "w", encoding="utf-8") as f:
        for row in rejected:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    generated = len(tasks) * args.samples
    stats = {
        "model": args.model, "tasks_file": str(args.tasks),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "seed": args.seed, "temperature": args.temperature,
        "samples": args.samples, "total_tasks": len(tasks),
        "generated_samples": generated,
        "accepted_tasks": accepted_tasks,
        "task_accept_rate": round(accepted_tasks / len(tasks), 4) if tasks else None,
        "accepted_samples": len(accepted),
        "sample_accept_rate": round(len(accepted) / generated, 4) if generated else None,
        "rejected_samples": len(rejected),
        "dedup_dropped": dedup_dropped,
        "latency_avg_ms": round(sum(lat) / len(lat)) if lat else None,
        "wall_clock_sec": round(time.monotonic() - t_start, 1),
    }
    if args.stats:
        Path(args.stats).parent.mkdir(parents=True, exist_ok=True)
        Path(args.stats).write_text(
            json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(stats, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
