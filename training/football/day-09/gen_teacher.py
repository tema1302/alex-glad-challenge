# День 9 (футбольный трек): генерация ответов учителя (Ollama, qwen2.5:7b)
# для train-пула задач JSON -> репортаж + фильтрация rule-скорером.
# Принятые пары складываются в data/distill_train.jsonl (messages-формат).
# Eval-задачи в обучение НЕ попадают (assert на уровне gen_tasks).
#
# Запуск (Ollama на localhost:11434):
#   python gen_teacher.py --model qwen2.5:7b-instruct

import argparse
import json
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from report_rules import facts_present, missing_facts

ROOT = Path(__file__).resolve().parent

SYSTEM = ("Ты спортивный журналист. По JSON-описанию футбольного матча "
          "напиши короткий репортаж: один-два предложения, только факты из "
          "JSON (клубы, счёт, авторы и минуты голов, турнир). Без заголовков, "
          "без оценок, без информации не из JSON. До 240 символов.")


def ask_ollama(base_url, model, messages, seed):
    r = requests.post(f"{base_url}/api/chat", json={
        "model": model, "messages": messages, "stream": False,
        "options": {"temperature": 0, "seed": seed},
    }, timeout=180)
    r.raise_for_status()
    return r.json()["message"]["content"].strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="qwen2.5:7b-instruct")
    ap.add_argument("--base-url", default="http://localhost:11434")
    ap.add_argument("--tasks", default=str(ROOT / "data" / "train_tasks.json"))
    ap.add_argument("--out", default=str(ROOT / "data" / "distill_train.jsonl"))
    ap.add_argument("--rejects", default=str(ROOT / "data" / "rejected.jsonl"))
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    tasks = json.loads(Path(args.tasks).read_text(encoding="utf-8"))
    accepted, rejected = [], []
    t0 = time.monotonic()
    for i, task in enumerate(tasks):
        user = ("Напиши репортаж по этому JSON:\n"
                + json.dumps(task, ensure_ascii=False))
        raw = ask_ollama(args.base_url, args.model,
                         [{"role": "system", "content": SYSTEM},
                          {"role": "user", "content": user}], args.seed)
        ok = facts_present(task, raw)
        (accepted if ok else rejected).append(
            {"task": task, "report": raw,
             "missing": [] if ok else missing_facts(task, raw)})
        print(f"[{i+1}/{len(tasks)}] {'OK' if ok else 'REJ'} "
              f"{raw[:80]}", flush=True)

    with open(args.out, "w", encoding="utf-8") as f:
        for row in accepted:
            f.write(json.dumps({
                "messages": [
                    {"role": "system", "content": SYSTEM},
                    {"role": "user", "content": "Напиши репортаж по этому JSON:\n"
                        + json.dumps(row["task"], ensure_ascii=False)},
                    {"role": "assistant", "content": row["report"]},
                ]}, ensure_ascii=False) + "\n")
    with open(args.rejects, "w", encoding="utf-8") as f:
        for row in rejected:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    wall = round(time.monotonic() - t0, 1)
    stats = {"model": args.model, "total": len(tasks),
             "accepted": len(accepted), "rejected": len(rejected),
             "accept_rate": round(len(accepted) / len(tasks), 3),
             "wall_s": wall}
    Path(args.out).with_name("teacher_stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(stats, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
