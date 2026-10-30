# Замеры БЕЗ тюна (baseline, #159): eval-набор на базовой модели через Ollama
# в двух режимах:
#   none   — только user (без инструкций);
#   prompt — проработанный system (схема + правила + 3 few-shot из train-домена).
# Это числа, которые тюнинг обязан превзойти (день-07, шаг 2).
#
# Запуск:
#   python eval_baseline.py --model qwen2.5:1.5b-instruct \
#     --modes none,prompt --out ../../docs/advanced-day-07/eval
#
# Выход: results.jsonl (покейсово), baseline.json (метрики), report.md.

import argparse
import json
import re
import statistics
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EVAL_FILE = ROOT / "eval" / "eval_set.jsonl"

# Проработанный промпт: схема + правила + 3 few-shot (входы из train-домена,
# НЕ из eval; действия не пересекаются с eval-списком по построению seeds.py).
FEWSHOT = [
    ("напоминай полить цветы каждый вторник",
     {"text": "Полить цветы", "recurring": "weekly", "day_of_week": 2,
      "interval_hours": None}),
    ("не забудь каждый день сделать бэкап репозитория",
     {"text": "Сделать бэкап репозитория", "recurring": "daily",
      "day_of_week": None, "interval_hours": None}),
    ("раз в 4 часа проверять очередь задач",
     {"text": "Проверять очередь задач", "recurring": "hourly",
      "day_of_week": None, "interval_hours": 4}),
]

PROMPT_SYSTEM = """Ты конвертер задач: превращаешь фразу пользователя в JSON для планировщика повторяющихся задач.

Схема JSON (все 4 поля обязательны):
{{"text": "<строгое действие>", "recurring": null | "daily" | "weekly" | "hourly", "day_of_week": null | 0-6, "interval_hours": null | целое >= 1}}

Правила:
1. "text" — что делать, БЕЗ слов о расписании ("каждый", "ежедневно", "напоминай", "не забудь", "нужно", "пора") и без названий дней/часов. Время дня ("в 20:00") можно оставить.
2. "recurring" = "daily", если повтор каждый день/утро/вечер; "weekly" — если указан день недели; "hourly" — если повтор каждые N часов (N >= 1, целые часы); null — если повтора нет.
3. "day_of_week": 0=воскресенье, 1=понедельник, 2=вторник, 3=среда, 4=четверг, 5=пятница, 6=суббота (только для weekly).
4. "interval_hours" — только для hourly, целое число часов >= 1.
5. Если расписание непредставимо (два дня, интервал в днях/минутах, абсолютная дата) — recurring=null, а весь текст оставь как есть.
6. Ответ — ТОЛЬКО компактный JSON в одну строку, без пояснений и markdown.

Примеры:
{ex}""".format(ex="\n".join(
    f"Вход: {i!r}\nОтвет: {json.dumps(g, ensure_ascii=False, separators=(',', ':'))}"
    for i, g in FEWSHOT
))


def ollama_chat(model: str, messages: list[dict], seed: int = 42,
                timeout: int = 180) -> str:
    body = json.dumps({
        "model": model,
        "messages": messages,
        "stream": False,
        "options": {"temperature": 0, "seed": seed, "num_predict": 200},
    }).encode("utf-8")
    req = urllib.request.Request(
        "http://localhost:11434/api/chat", data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["message"]["content"]


def extract_json(raw: str) -> dict | None:
    """Первый сбалансированный JSON-объект в ответе (терпит ```json-фенсы)."""
    start = raw.find("{")
    if start == -1:
        return None
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(raw)):
        ch = raw[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(raw[start:i + 1])
                except json.JSONDecodeError:
                    return None
    return None


def is_format_ok(raw: str) -> bool:
    """Строгий формат: ответ — ровно один JSON-объект без прозы/markdown."""
    stripped = re.sub(r"^```(?:json)?|```$", "", raw.strip()).strip()
    return bool(re.fullmatch(r"\{.*\}", stripped, re.DOTALL))


def norm_gold(g: dict) -> dict:
    return {
        "text": (g.get("text") or "").strip(),
        "recurring": g.get("recurring"),
        "day_of_week": g.get("day_of_week"),
        "interval_hours": g.get("interval_hours"),
    }


def score(pred_raw: str, gold: dict) -> dict:
    pred = extract_json(pred_raw)
    if pred is None:
        return {"parse_ok": False, "format_ok": is_format_ok(pred_raw),
                "full_match": False, "field_text": False,
                "field_recurring": False, "field_day_of_week": False,
                "field_interval": False}
    pred_n = {
        "text": str(pred.get("text", "")).strip(),
        "recurring": pred.get("recurring"),
        "day_of_week": pred.get("day_of_week"),
        "interval_hours": pred.get("interval_hours"),
    }
    g = norm_gold(gold)
    fields = {k: pred_n[k] == g[k] for k in g}
    # числовые поля: 2.0 == 2 допустимо
    for k in ("day_of_week", "interval_hours"):
        if not fields[k] and pred_n[k] is not None and g[k] is not None:
            try:
                fields[k] = int(float(pred_n[k])) == int(float(g[k]))
            except (TypeError, ValueError):
                pass
    return {"parse_ok": True, "format_ok": is_format_ok(pred_raw),
            "full_match": all(fields.values()),
            "field_text": fields["text"],
            "field_recurring": fields["recurring"],
            "field_day_of_week": fields["day_of_week"],
            "field_interval": fields["interval_hours"]}


def run_mode(mode: str, model: str) -> list[dict]:
    rows = []
    with open(EVAL_FILE, encoding="utf-8") as f:
        cases = [json.loads(line) for line in f if line.strip()]
    for c in cases:
        messages = ([{"role": "system", "content": PROMPT_SYSTEM}] if mode == "prompt" else [])
        messages.append({"role": "user", "content": c["input"]})
        t0 = time.perf_counter()
        try:
            out = ollama_chat(model, messages)
            err = None
        except Exception as e:  # noqa: BLE001 — ошибка запроса фиксируется покейсово
            out = ""
            err = str(e)[:120]
        dt_ms = round((time.perf_counter() - t0) * 1000, 1)
        row = {"id": c["id"], "mode": mode, "input": c["input"],
               "output": out[:400], "latency_ms": dt_ms}
        row.update(score(out, c["gold"]))
        row["error"] = err
        rows.append(row)
        print(f"[{mode}] {c['id']}: full_match={row['full_match']} "
              f"parse={row['parse_ok']} {dt_ms}ms")
    return rows


def gold_class_by_id() -> dict[str, str]:
    with open(EVAL_FILE, encoding="utf-8") as f:
        return {c["id"]: str(c["gold"]["recurring"])
                for c in (json.loads(line) for line in f if line.strip())}


def summarize(rows: list[dict]) -> dict:
    n = len(rows)
    class_of = gold_class_by_id()
    by_rec: dict[str, list[dict]] = {}
    for r in rows:
        by_rec.setdefault(class_of[r["id"]], []).append(r)
    per_class = {k: {
        "n": len(v),
        "full_match": sum(x["full_match"] for x in v),
        "parse_ok": sum(x["parse_ok"] for x in v),
    } for k, v in sorted(by_rec.items())}
    lat = [r["latency_ms"] for r in rows if r["error"] is None]
    return {
        "n": n,
        "parse_ok": sum(r["parse_ok"] for r in rows),
        "format_ok": sum(r["format_ok"] for r in rows),
        "full_match": sum(r["full_match"] for r in rows),
        "field_text": sum(r["field_text"] for r in rows),
        "field_recurring": sum(r["field_recurring"] for r in rows),
        "field_day_of_week": sum(r["field_day_of_week"] for r in rows),
        "field_interval": sum(r["field_interval"] for r in rows),
        "per_class": per_class,
        "latency_avg_ms": round(statistics.mean(lat), 1) if lat else None,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="qwen2.5:1.5b-instruct")
    ap.add_argument("--modes", default="none,prompt")
    ap.add_argument("--out", default=str(ROOT / ".." / ".." / "docs" / "advanced-day-07" / "eval"))
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    modes = [m.strip() for m in args.modes.split(",") if m.strip()]

    all_rows: list[dict] = []
    summary: dict[str, dict] = {}
    for mode in modes:
        rows = run_mode(mode, args.model)
        all_rows.extend(rows)
        summary[mode] = summarize(rows)
        print(f"== {mode}: full_match={summary[mode]['full_match']}/{summary[mode]['n']}, "
              f"parse_ok={summary[mode]['parse_ok']}, "
              f"latency={summary[mode]['latency_avg_ms']}ms")

    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    with open(out_dir / "baseline_results.jsonl", "w", encoding="utf-8") as f:
        for r in all_rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    meta = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "model": args.model,
        "provider": "ollama (локально, Windows, AMD RX 7600 без CUDA)",
        "temperature": 0, "seed": args.seed, "num_predict": 200,
        "modes": modes, "summary": summary,
        "eval_set": "training/day-07/eval/eval_set.jsonl (30 кейсов)",
    }
    with open(out_dir / "baseline.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    lines = [
        "# day-07 — baseline без тюна (реальный прогон)", "",
        f"- Модель: `{args.model}` (Ollama локально), temperature=0, seed={args.seed}",
        f"- Дата: {meta['timestamp_utc']}", "",
        "| Режим | parse_ok | format_ok | full_match | text | recurring | dow | interval | latency, мс |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for mode, s in summary.items():
        lines.append(
            f"| {mode} | {s['parse_ok']}/{s['n']} | {s['format_ok']}/{s['n']} | "
            f"{s['full_match']}/{s['n']} | {s['field_text']}/{s['n']} | "
            f"{s['field_recurring']}/{s['n']} | {s['field_day_of_week']}/{s['n']} | "
            f"{s['field_interval']}/{s['n']} | {s['latency_avg_ms']} |")
    lines += ["", "## По классам gold (full_match)", "",
              "| Режим | класс | full_match |", "|---|---|---|"]
    for mode, s in summary.items():
        for cls, st in s["per_class"].items():
            lines.append(f"| {mode} | {cls} | {st['full_match']}/{st['n']} |")
    lines += ["", "Метрики: parse_ok — JSON извлечён; format_ok — ответ ровно один "
              "JSON без прозы; full_match — все 4 поля совпали с gold. "
              "Покейсово: `baseline_results.jsonl`; параметры: `baseline.json`."]
    (out_dir / "baseline_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"OK -> {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
