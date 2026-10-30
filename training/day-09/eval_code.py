# День-09 s1 (#169): замер «спецификация → Python-функция» на двух моделях
# (учитель 7b vs ученик 1.5b-base) через Ollama. temperature=0, seed=42.
# Скоринг: извлечь def <name> из ответа, исполнить тесты задачи в
# неймспейсе с безопасным подмножеством builtins. pass@1 = все тесты зелёные.
#
# Запуск:
#   python eval_code.py --model qwen2.5-coder:1.5b-base \
#     --out ../../docs/advanced-day-09/eval/1.5b-base
#   python eval_code.py --model qwen2.5-coder:7b \
#     --out ../../docs/advanced-day-09/eval/7b
#
# Выход: results_<model>.jsonl, code.json, code_report.md в --out.

import builtins
import argparse
import json
import re
import statistics
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TASKS = ROOT / "data" / "tasks.jsonl"

SAFE_BUILTINS = {name: getattr(builtins, name) for name in (
    "abs min max sum len range str int float bool list dict set tuple "
    "sorted reversed enumerate zip any all isinstance round divmod pow ord chr "
    "print map filter next iter Exception ValueError TypeError"
).split()}

SYSTEM = ("Ты генерируешь код. Ответ — только код: одна функция по "
          "спецификации, без пояснений и примеров вызова.")


def load_tasks() -> list[dict]:
    with open(TASKS, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def extract_function(raw: str, name: str) -> str | None:
    """Первый def <name>(...) сбалансированный по отступам."""
    m = re.search(rf"^(def {re.escape(name)}\s*\(.*)$", raw,
                  re.MULTILINE)
    if not m:
        m = re.search(rf"(def {re.escape(name)}\s*\(.*)$", raw)
    if not m:
        return None
    lines = raw[m.start():].splitlines()
    body = [lines[0]]
    base = len(lines[0]) - len(lines[0].lstrip())
    for line in lines[1:]:
        if line.strip() and (len(line) - len(line.lstrip())) <= base:
            break
        body.append(line)
    return "\n".join(body) + "\n"


def run_tests(code: str, task: dict) -> tuple[int, int, str | None]:
    """Возвращает (пройдено, всего, ошибка)."""
    ns = {"__builtins__": SAFE_BUILTINS}
    try:
        exec(code, ns)  # noqa: S102 — код локальной модели в песочнице
    except Exception as e:  # noqa: BLE001
        return 0, len(task["tests"]), f"syntax: {type(e).__name__}"
    fn = ns.get(task["name"])
    if not callable(fn):
        return 0, len(task["tests"]), "function not defined"
    passed = 0
    for test in task["tests"]:
        try:
            got = fn(*test["args"])
            if got == test["expected"] and type(got) is type(test["expected"]):
                passed += 1
            else:
                return passed, len(task["tests"]), (
                    f"wrong: {test['args']} -> {got!r}, "
                    f"expected {test['expected']!r}")
        except Exception as e:  # noqa: BLE001
            return passed, len(task["tests"]), f"runtime: {type(e).__name__}"
    return passed, len(task["tests"]), None


def ollama_chat(model: str, messages: list[dict], seed: int = 42,
                timeout: int = 240) -> str:
    body = json.dumps({
        "model": model, "messages": messages, "stream": False,
        "options": {"temperature": 0, "seed": seed, "num_predict": 256},
    }).encode("utf-8")
    req = urllib.request.Request(
        "http://localhost:11434/api/chat", data=body,
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))["message"]["content"]


def safe_model_name(model: str) -> str:
    return re.sub(r"[^a-z0-9._-]", "_", model.lower())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    tasks = load_tasks()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    rows = []
    for task in tasks:
        t0 = time.monotonic()
        raw = ollama_chat(args.model, [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": task["spec"] + "\nОтвет: код."},
        ], seed=args.seed)
        dt = (time.monotonic() - t0) * 1000
        code = extract_function(raw, task["name"])
        if code is None:
            passed, total, err = 0, len(task["tests"]), "no def extracted"
        else:
            passed, total, err = run_tests(code, task)
        rows.append({
            "id": task["id"], "passed": passed, "total": total,
            "ok": passed == total, "error": err, "raw": raw[:600],
            "latency_ms": round(dt),
        })
        print(f"{task['id']}: {passed}/{total} {dt:.0f}ms", flush=True)

    solved = sum(r["ok"] for r in rows)
    summary = {
        "model": args.model,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "seed": args.seed, "n": len(rows), "pass1": solved,
        "pass1_acc": round(solved / len(rows), 4),
        "latency_avg_ms": round(statistics.mean(r["latency_ms"] for r in rows)),
    }
    with open(out_dir / f"results_{safe_model_name(args.model)}.jsonl", "w",
              encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    (out_dir / "code.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        f"# Code eval — {args.model} (day-09 s1)", "",
        f"Сгенерировано: {summary['generated_at']}, seed={args.seed}",
        f"Задач: {len(rows)}; pass@1 = все тесты задачи зелёные.", "",
        f"**pass@1: {solved}/{len(rows)} ({summary['pass1_acc']:.0%})**, "
        f"latency avg {summary['latency_avg_ms']} мс.", "",
        "| ID | тесты | ошибка |", "|---|---|---|",
    ]
    for r in rows:
        err = (r["error"] or "—")[:60].replace("|", "/")
        lines.append(f"| {r['id']} | {r['passed']}/{r['total']} | {err} |")
    (out_dir / "code_report.md").write_text(
        "\n".join(lines) + "\n", encoding="utf-8")
    print(f"pass@1 {solved}/{len(rows)} -> {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
