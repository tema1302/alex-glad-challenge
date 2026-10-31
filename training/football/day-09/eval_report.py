# День 9 (футбольный трек): сравнение трёх вариантов на eval-наборе (30 задач).
#   ученик до   — Qwen2.5-0.5B без адаптера (тот же рантайм, что и tuned);
#   ученик после — 0.5B + LoRA-адаптер дистилляции;
#   учитель      — qwen2.5:7b-instruct через Ollama (тот же промпт).
# Качество: доля репортажей, где rule-скорер нашёл все факты JSON.
# Замеры: latency каждого запроса; «стоимость» — размер модели и время
# генерации (рантаймы разные, честно фиксируем: transformers/CPU vs Ollama).
#
# Запуск: python eval_report.py --adapter ../artifacts/adapter-epoch3 \
#           --out ../../../docs/advanced-day-09/football/eval

import argparse
import importlib.metadata
import json
import platform
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "day-08"))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from common import ROOT, generate, load_model  # noqa: E402,E401
from report_rules import facts_present  # noqa: E402

PACKAGES = ["torch", "transformers", "peft"]

STUDENT_SYSTEM = ("Ты спортивный журналист. По JSON-описанию футбольного "
                  "матча напиши короткий репортаж: один-два предложения, "
                  "только факты из JSON (клубы, счёт, авторы и минуты голов, "
                  "турнир). Без заголовков, без оценок, без информации не из "
                  "JSON. До 240 символов.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="Qwen/Qwen2.5-0.5B-Instruct")
    ap.add_argument("--adapter", required=True)
    ap.add_argument("--teacher", default="qwen2.5:7b-instruct")
    ap.add_argument("--base-url", default="http://localhost:11434")
    ap.add_argument("--tasks", default=str(ROOT / "data" / "eval_tasks.json"))
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    tasks = json.loads(Path(args.tasks).read_text(encoding="utf-8"))
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    model, tokenizer = load_model(args.model)
    from peft import PeftModel
    tuned = PeftModel.from_pretrained(model, args.adapter)

    rows = []
    t0 = time.monotonic()
    for variant in ("student-before", "student-after", "teacher"):
        for i, task in enumerate(tasks):
            user = "Напиши репортаж по этому JSON:\n" + json.dumps(
                task, ensure_ascii=False)
            t1 = time.monotonic()
            if variant == "teacher":
                r = requests.post(f"{args.base_url}/api/chat", json={
                    "model": args.teacher,
                    "messages": [{"role": "system", "content": STUDENT_SYSTEM},
                                 {"role": "user", "content": user}],
                    "stream": False,
                    "options": {"temperature": 0, "seed": args.seed},
                }, timeout=180)
                r.raise_for_status()
                raw = r.json()["message"]["content"].strip()
            else:
                messages = [{"role": "system", "content": STUDENT_SYSTEM},
                            {"role": "user", "content": user}]
                if variant == "student-after":
                    raw = generate(tuned, tokenizer, messages, 220)
                else:
                    with tuned.disable_adapter():
                        raw = generate(tuned, tokenizer, messages, 220)
            dt = (time.monotonic() - t1) * 1000
            ok = facts_present(task, raw)
            rows.append({"variant": variant, "task_id": i, "task": task,
                         "raw": raw, "ok": ok, "latency_ms": round(dt)})
            print(f"[{variant}] task{i} ok={ok} {dt:.0f}ms", flush=True)

    def agg(variant):
        rs = [r for r in rows if r["variant"] == variant]
        return {"facts_ok": sum(r["ok"] for r in rs), "n": len(rs),
                "acc": round(sum(r["ok"] for r in rs) / len(rs), 3),
                "latency_ms_avg": round(statistics.mean(r["latency_ms"] for r in rs))}

    summary = {v: agg(v) for v in ("student-before", "student-after", "teacher")}
    env = {
        "student": args.model, "adapter": str(args.adapter),
        "teacher": args.teacher,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "seed": args.seed, "platform": platform.platform(),
        "python": sys.version.split()[0],
        "packages": {p: importlib.metadata.version(p) for p in PACKAGES},
        "variants": summary, "wall_s": round(time.monotonic() - t0, 1),
    }
    with open(out_dir / "results.jsonl", "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    (out_dir / "compare.json").write_text(
        json.dumps(env, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = ["# Дистилляция: ученик до/после vs учитель (day-09 football)", "",
             "| Вариант | facts_ok | acc | latency avg |",
             "|---|---|---|---|"]
    for v in ("student-before", "student-after", "teacher"):
        s = summary[v]
        lines.append(f"| {v} | {s['facts_ok']}/{s['n']} | {s['acc']} | "
                     f"{s['latency_ms_avg']} ms |")
    lines += ["",
              "- Рантаймы разные: ученик — transformers/CPU fp32, учитель — "
              "Ollama. Качество (rule-скорер) сравнимо, latency — только "
              "внутри своего варианта.",
              "- Стоимость: ученик 0.5B (~1 ГБ весов, CPU) против учителя "
              "7B (~4.7 ГБ, Ollama)."]
    (out_dir / "compare_report.md").write_text(
        "\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
