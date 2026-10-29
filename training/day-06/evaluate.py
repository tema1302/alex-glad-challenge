# Сравнение base vs tuned на фиксированном наборе eval/prompts.jsonl.
# Методология: ОДНА 4-bit загрузка Qwen2.5-1.5B-Instruct + LoRA-adapter поверх.
# Base = та же загрузка с отключённым адаптером (model.disable_adapter()),
# tuned = с адаптером. Разница ровно одна — adapter, tokenizer/template/decoding
# идентичны. temperature=0 (do_sample=False), max_new_tokens=256, seed=42.
#
# Метрики: format_ok, parse_ok (sqlglot), schema_ok (SQLite EXPLAIN QUERY PLAN
# на in-memory БД из контекста), normalized_match (strict, против gold),
# latency_ms, completion_tokens, regression (tuned выдал SQL там, где не надо).
#
# Выход (--out): results.jsonl, report.md, regressions.md, report.html.

import argparse
import html
import json
import sqlite3
import sys
import time
from pathlib import Path

import sqlglot
import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

ROOT = Path(__file__).resolve().parent
SYSTEM_PROMPT = (
    "You are a text-to-SQL engine. Given a SQLite schema and a question,\n"
    "output exactly one SQL query and nothing else. Do not use markdown.\n"
    "Use only tables and columns from the schema."
)
MAX_NEW_TOKENS = 256
SEED = 42
SQL_START_KEYWORDS = (
    "select", "with", "insert", "update", "delete", "explain",
    "create", "alter", "drop", "values", "replace", "pragma",
)


def load_prompts(path: Path) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def build_user(row: dict) -> str:
    ctx = row["context"].strip()
    return f"Schema:\n{ctx if ctx else '(none)'}\n\nQuestion:\n{row['question']}"


def looks_like_sql(text: str) -> bool:
    head = text.strip().lstrip("(").split(None, 1)
    return bool(head) and head[0].rstrip(";").lower() in SQL_START_KEYWORDS


def format_ok(text: str) -> bool:
    t = text.strip()
    if not t or "```" in t or "<|" in t:
        return False
    if not looks_like_sql(t):
        return False
    tail = t.rstrip().rstrip(";").rstrip()
    # после первой ';' — только whitespace
    semi = tail.find(";")
    if semi != -1 and tail[semi + 1:].strip():
        return False
    # строки вне скобочных конструкций не должны начинаться с прозы
    for line in tail.splitlines()[1:]:
        s = line.strip()
        if s and looks_like_prose(s):
            return False
    return True


def looks_like_sql_piece(line: str) -> bool:
    s = line.strip().lstrip("),(")
    return not s or looks_like_sql(s) or s[0] in "),(" or s.split(None, 1)[0].lower() in {
        "from", "where", "group", "order", "limit", "join", "on", "and", "or",
        "having", "union", "intersect", "except", "as", "when", "then", "else", "end",
        "left", "right", "inner", "outer", "cross", "not", "in", "between", "like",
        "case", "distinct", "set", "values",
    }


def looks_like_prose(line: str) -> bool:
    s = line.strip()
    if not s:
        return False
    low = s.lower()
    if low.split(None, 1)[0] in {"the", "this", "here", "note", "sure", "certainly", "sure,"}:
        return True
    # предложение с глаголом-вводкой и без SQL-пунктации
    if len(s.split()) > 3 and not any(ch in s for ch in "(),=*<>'\""):
        return True
    return False


def parse_ok(text: str) -> bool:
    try:
        sqlglot.parse_one(text.strip().rstrip(";"), dialect="sqlite")
        return True
    except Exception:
        return False


def schema_ok(context: str, sql: str) -> bool:
    ctx = context.strip()
    if not ctx.upper().startswith("CREATE"):
        return None  # нечего проверять — нет schema
    conn = sqlite3.connect(":memory:")
    try:
        conn.executescript(ctx)
        conn.execute("EXPLAIN QUERY PLAN " + sql.strip().rstrip(";"))
        return True
    except Exception:
        return False
    finally:
        conn.close()


def norm_sql(s: str) -> str | None:
    try:
        return sqlglot.parse_one(s, dialect="sqlite").sql(dialect="sqlite", normalize=True).lower().strip()
    except Exception:
        return None


def normalized_match(text: str, gold: str) -> bool:
    if not gold:
        return False
    a, b = norm_sql(text), norm_sql(gold)
    return a is not None and a == b


@torch.inference_mode()
def generate(model, tokenizer, row: dict) -> tuple[str, int, int]:
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": build_user(row)},
    ]
    prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    torch.manual_seed(SEED)
    t0 = time.perf_counter()
    out = model.generate(
        **inputs,
        max_new_tokens=MAX_NEW_TOKENS,
        do_sample=False,
        pad_token_id=tokenizer.pad_token_id,
    )
    latency_ms = int((time.perf_counter() - t0) * 1000)
    gen = out[0][inputs["input_ids"].shape[1]:]
    text = tokenizer.decode(gen, skip_special_tokens=True)
    return text, latency_ms, int(gen.numel())


def regression_reason(row: dict) -> str:
    if row["bucket"] == "ood":
        if row["id"] in ("ood-chat", "ood-russian"):
            return "catastrophic forgetting: роль «SQL engine» затёрла общий чат/язык"
        return "over-SQL bias: математика/перевод/объяснение отвечены SQL-запросом"
    if row["id"] == "edge-insert":
        return "SELECT-bias: датасет содержит только SELECT, DML-просьба превращена в SELECT"
    if row["id"] == "edge-invalid-column":
        return "hallucinated column: tuned уверенно ссылается на несуществующую колонку"
    if row["id"] == "edge-empty-schema":
        return "over-SQL bias: SQL выдан вообще без schema"
    return "роль «только SQL» не оставляет места отказу/уточнению"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompts", default=str(ROOT / "eval" / "prompts.jsonl"))
    ap.add_argument("--adapter", default=str(ROOT / "artifacts" / "adapter"))
    ap.add_argument("--base", default="Qwen/Qwen2.5-1.5B-Instruct")
    ap.add_argument("--out", default=str(ROOT / "artifacts" / "eval"))
    args = ap.parse_args()

    prompts = load_prompts(Path(args.prompts))
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    tokenizer = AutoTokenizer.from_pretrained(args.base)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    model = AutoModelForCausalLM.from_pretrained(
        args.base,
        quantization_config=BitsAndBytesConfig(load_in_4bit=True),
        device_map="auto",
        attn_implementation="sdpa",
    )
    model = PeftModel.from_pretrained(model, args.adapter)

    results = []
    for row in prompts:
        with model.disable_adapter():
            base_text, base_ms, base_tok = generate(model, tokenizer, row)
        tuned_text, tuned_ms, tuned_tok = generate(model, tokenizer, row)

        base = {
            "output": base_text,
            "format_ok": format_ok(base_text),
            "parse_ok": parse_ok(base_text),
            "schema_ok": schema_ok(row["context"], base_text),
            "normalized_match": normalized_match(base_text, row.get("gold") or ""),
            "latency_ms": base_ms,
            "completion_tokens": base_tok,
        }
        tuned = {
            "output": tuned_text,
            "format_ok": format_ok(tuned_text),
            "parse_ok": parse_ok(tuned_text),
            "schema_ok": schema_ok(row["context"], tuned_text),
            "normalized_match": normalized_match(tuned_text, row.get("gold") or ""),
            "latency_ms": tuned_ms,
            "completion_tokens": tuned_tok,
        }
        tuned["regression"] = bool(
            row["bucket"] in ("edge", "ood")
            and tuned["format_ok"]
            and not base["format_ok"]
        )
        results.append({"id": row["id"], "bucket": row["bucket"], "question": row["question"],
                        "context": row["context"], "gold": row.get("gold"), **{f"base_{k}": v for k, v in base.items()}, **{f"tuned_{k}": v for k, v in tuned.items()}})
        mark = "REGRESSION" if tuned["regression"] else "ok"
        print(f"[{row['id']}] base={base['format_ok']}/{base['normalized_match']} "
              f"tuned={tuned['format_ok']}/{tuned['normalized_match']} -> {mark}", flush=True)

    with open(out_dir / "results.jsonl", "w", encoding="utf-8") as f:
        for r in results:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    write_report_md(results, out_dir / "report.md")
    write_regressions(results, out_dir / "regressions.md")
    write_report_html(results, out_dir / "report.html")
    print(f"written: {out_dir / 'results.jsonl'}, report.md, regressions.md, report.html")
    return 0


def verdict(r: dict) -> str:
    if r["tuned_regression"]:
        return "❌ regression"
    if r["bucket"] == "in-domain":
        if r["tuned_normalized_match"]:
            return "✅ exact"
        return "✅" if r["tuned_schema_ok"] else "⚠️ wrong"
    # edge: корректное поведение tuned — НЕ выдавать сырой SQL (или корректный SQL для insert)
    if r["id"] == "edge-insert":
        if r["tuned_normalized_match"]:
            return "✅"
        return "⚠️ select-bias" if r["tuned_format_ok"] else "✅ explained"
    if r["bucket"] == "edge":
        if not r["tuned_format_ok"]:
            return "✅ refused/explained"
        return "⚠️ sql-anyway" if r["tuned_schema_ok"] else "❌ sql-anyway"
    # ood
    return "✅" if not r["tuned_format_ok"] else "❌ sql-answer"


def aggregate(results: list[dict]) -> dict:
    def cnt(side, key, bucket=None):
        rs = [r for r in results if bucket is None or r["bucket"] == bucket]
        return sum(1 for r in rs if r[f"{side}_{key}"])
    n = len(results)
    ind = [r for r in results if r["bucket"] == "in-domain"]
    return {
        "n": n,
        "format_base": cnt("base", "format_ok"),
        "format_tuned": cnt("tuned", "format_ok"),
        "format_in_base": cnt("base", "format_ok", "in-domain"),
        "format_in_tuned": cnt("tuned", "format_ok", "in-domain"),
        "exact_base": sum(1 for r in ind if r["base_normalized_match"]),
        "exact_tuned": sum(1 for r in ind if r["tuned_normalized_match"]),
        "schema_base": sum(1 for r in ind if r["base_schema_ok"]),
        "schema_tuned": sum(1 for r in ind if r["tuned_schema_ok"]),
        "regressions": sum(1 for r in results if r["tuned_regression"]),
        "lat_base_avg": round(sum(r["base_latency_ms"] for r in results) / n),
        "lat_tuned_avg": round(sum(r["tuned_latency_ms"] for r in results) / n),
    }


def summary_table(a: dict) -> str:
    return (
        "| Метрика (20 запросов) | Base | Tuned |\n|---|---|---|\n"
        f"| format_ok (все) | {a['format_base']}/20 | {a['format_tuned']}/20 |\n"
        f"| format_ok (in-domain) | {a['format_in_base']}/10 | {a['format_in_tuned']}/10 |\n"
        f"| exact match (in-domain, strict) | {a['exact_base']}/10 | {a['exact_tuned']}/10 |\n"
        f"| schema_ok (in-domain) | {a['schema_base']}/10 | {a['schema_tuned']}/10 |\n"
        f"| regressions (edge+ood) | — | {a['regressions']}/10 |\n"
        f"| latency avg, ms | {a['lat_base_avg']} | {a['lat_tuned_avg']} |\n"
    )


def clip(s: str, n: int = 90) -> str:
    s = " ".join(s.split())
    return s if len(s) <= n else s[: n - 1] + "…"


def write_report_md(results: list[dict], path: Path) -> None:
    a = aggregate(results)
    lines = [
        "# Day 6 — text-to-SQL LoRA: base vs tuned",
        "",
        "Base: Qwen2.5-1.5B-Instruct (4-bit NF4, adapter отключён). "
        "Tuned: та же загрузка + LoRA adapter. Decoding: temperature=0, "
        "max_new_tokens=256, seed=42, одинаковый chat template.",
        "",
        "⚠️ Ручная оценка (1–5) — колонки `fmt/corr/adh` заполняются вручную после просмотра outputs.",
        "",
        summary_table(a),
        "",
        "## Все 20 запросов",
        "",
        "| # | id | bucket | question | base (кратко) | tuned (кратко) | exact | verdict | fmt | corr | adh |",
        "|---|----|--------|----------|---------------|----------------|-------|---------|-----|------|-----|",
    ]
    for r in results:
        lines.append(
            f"| {r['id'].split('-')[0]} | {r['id']} | {r['bucket']} | {clip(r['question'], 60)} "
            f"| {clip(r['base_output'], 60)} | {clip(r['tuned_output'], 60)} "
            f"| {'✅' if r['tuned_normalized_match'] else '—'} | {verdict(r)} |  |  |  |"
        )
    lines += [
        "",
        "## Где стало хуже (regressions)",
        "",
        "Детали и полные outputs: [regressions.md](regressions.md). "
        "Это ожидаемый эффект узкого SFT, а не «баг»: цена жёсткой роли — "
        "потеря гибкости вне роли.",
        "",
    ]
    for r in results:
        if r["tuned_regression"]:
            lines.append(f"- **{r['id']}** — {regression_reason(r)}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_regressions(results: list[dict], path: Path) -> None:
    regs = [r for r in results if r["tuned_regression"]]
    lines = [
        "# Day 6 — где tuned стал хуже base",
        "",
        f"Всего регрессий: {len(regs)} из 10 edge/OOD-запросов. "
        "Каждая — предсказуемое следствие обучения на датасете, состоящем "
        "на 100% из SELECT и одной роли «SQL engine».",
        "",
    ]
    for r in regs:
        lines += [
            f"## {r['id']} ({r['bucket']})",
            "",
            f"- Вопрос: {r['question']}",
            f"- Schema: `{r['context'] or '(none)'}`",
            f"- Причина: **{regression_reason(r)}**",
            "",
            "**Base output:**",
            "",
            "```", r["base_output"].strip() or "(пусто)", "```",
            "",
            "**Tuned output:**",
            "",
            "```", r["tuned_output"].strip() or "(пусто)", "```",
            "",
            f"Метрики: base format_ok={r['base_format_ok']}, tuned format_ok={r['tuned_format_ok']}, "
            f"tuned schema_ok={r['tuned_schema_ok']}, latency base/tuned = {r['base_latency_ms']}/{r['tuned_latency_ms']} ms",
            "",
            "---",
            "",
        ]
    if not regs:
        lines.append("Регрессий не обнаружено — проверь, что adapter действительно подключался.")
    path.write_text("\n".join(lines), encoding="utf-8")


def write_report_html(results: list[dict], path: Path) -> None:
    a = aggregate(results)
    rows = []
    for r in results:
        rows.append(
            "<tr>"
            f"<td>{html.escape(str(r['id']))}</td><td>{html.escape(r['bucket'])}</td>"
            f"<td>{html.escape(clip(r['question'], 80))}</td>"
            f"<td><details><summary>{html.escape(clip(r['base_output'], 50))}</summary><pre>{html.escape(r['base_output'])}</pre></details></td>"
            f"<td><details><summary>{html.escape(clip(r['tuned_output'], 50))}</summary><pre>{html.escape(r['tuned_output'])}</pre></details></td>"
            f"<td>{'✅' if r['tuned_normalized_match'] else '—'}</td>"
            f"<td>{html.escape(verdict(r))}</td>"
            f"<td>{r['base_latency_ms']}/{r['tuned_latency_ms']} ms</td>"
            "</tr>"
        )
    reg_html = "".join(
        f"<li><b>{html.escape(r['id'])}</b> — {html.escape(regression_reason(r))}</li>"
        for r in results if r["tuned_regression"]
    )
    doc = f"""<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>Day 6 — SQL LoRA eval</title>
<style>
body{{font-family:system-ui,sans-serif;max-width:1200px;margin:2rem auto;padding:0 1rem;color:#1a1a2e}}
table{{border-collapse:collapse;width:100%;font-size:14px}}
td,th{{border:1px solid #ccd;padding:6px;vertical-align:top}}
th{{background:#f4f4f8}}pre{{white-space:pre-wrap;margin:0;background:#f8f8fb;padding:8px;border-radius:6px}}
summary{{cursor:pointer}}code{{background:#f0f0f4;padding:1px 4px;border-radius:4px}}
</style></head><body>
<h1>Day 6 — text-to-SQL LoRA: base vs tuned</h1>
<p>Base: Qwen2.5-1.5B-Instruct (4-bit, adapter отключён) · Tuned: + LoRA adapter.
temperature=0, max_new_tokens=256, seed=42, одинаковый chat template.</p>
<h2>Сводка</h2>
<table>
<tr><th>Метрика</th><th>Base</th><th>Tuned</th></tr>
<tr><td>format_ok (все)</td><td>{a['format_base']}/20</td><td>{a['format_tuned']}/20</td></tr>
<tr><td>format_ok (in-domain)</td><td>{a['format_in_base']}/10</td><td>{a['format_in_tuned']}/10</td></tr>
<tr><td>exact match (in-domain, strict)</td><td>{a['exact_base']}/10</td><td>{a['exact_tuned']}/10</td></tr>
<tr><td>schema_ok (in-domain)</td><td>{a['schema_base']}/10</td><td>{a['schema_tuned']}/10</td></tr>
<tr><td>regressions (edge+ood)</td><td>—</td><td>{a['regressions']}/10</td></tr>
<tr><td>latency avg, ms</td><td>{a['lat_base_avg']}</td><td>{a['lat_tuned_avg']}</td></tr>
</table>
<h2>Все 20 запросов</h2>
<table>
<tr><th>id</th><th>bucket</th><th>question</th><th>base output</th><th>tuned output</th><th>exact</th><th>verdict</th><th>lat b/t</th></tr>
{''.join(rows)}
</table>
<h2>Где стало хуже</h2>
<ul>{reg_html}</ul>
</body></html>"""
    path.write_text(doc, encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
