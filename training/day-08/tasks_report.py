# День-08 s4 (#167): сводный отчёт «три типа задач» — формат / стиль-тон /
# факты. Считает прирост промпта (base-prompt vs base-none) и прирост тюна
# (tuned vs base-none) по уже снятым замерам:
#   формат  — day-07 eval (docs/advanced-day-07/eval/tuned.json, Kaggle T4);
#   факты   — day-08 s1 (docs/advanced-day-08/eval/{1.5b,7b}/facts.json, Ollama)
#             + facts-tuned (Kaggle, tuned vs base-none);
#   стиль   — day-08 s4 (docs/advanced-day-08/eval/style-*/style.json).
#
# Запуск: python tasks_report.py --out ../../docs/advanced-day-08/eval

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT / ".." / ".."


def load(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def delta(a: float | None, b: float | None) -> str:
    if a is None or b is None:
        return "н/д"
    return f"{a - b:+.2f}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    tuned07 = load(REPO / "docs/advanced-day-07/eval/tuned.json")
    fm = {m: tuned07["summary"][m]["full_match"] / tuned07["summary"][m]["n"]
          for m in ("tuned", "base-prompt", "base-none")}

    facts_local = {
        m: load(REPO / f"docs/advanced-day-08/eval/{m}/facts.json")["modes"]
        for m in ("1.5b", "7b")
    }
    facts_tuned_file = REPO / "docs/advanced-day-08/eval/facts-tuned/facts.json"
    facts_tuned = load(facts_tuned_file)["modes"] if facts_tuned_file.exists() \
        else None

    style_rows = {}
    for name in ("style-1.5b", "style-7b", "style-tuned"):
        p = REPO / f"docs/advanced-day-08/eval/{name}/style.json"
        if p.exists():
            style_rows[name] = load(p)["modes"]

    lines = [
        "# Три типа задач: прирост тюна vs прирост промпта (day-08 s4)", "",
        "Метрики по задачам: формат — full_match (day-07, 30 кейсов); факты — "
        "exact acc (72 вопроса по 36 выдуманным фактам); стиль — доля "
        "выполненных rule-ограничений (12 кейсов).", "",
        "## Формат (day-07, Kaggle T4, один рантайм)", "",
        "| Модель | full_match |",
        "|---|---|",
        f"| base-none | {fm['base-none']:.2f} |",
        f"| base-prompt | {fm['base-prompt']:.2f} (Δпромпт {delta(fm['base-prompt'], fm['base-none'])}) |",
        f"| tuned | {fm['tuned']:.2f} (Δтюн {delta(fm['tuned'], fm['base-none'])}) |",
        "",
        "## Факты (day-08 s1; tuned — Kaggle T4)", "",
        "| Модель | exact |",
        "|---|---|",
    ]
    for label, modes in facts_local.items():
        none = modes["none"]["exact_acc"]
        prompt = modes["prompt"]["exact_acc"]
        lines.append(f"| {label} base-none | {none:.2f} |")
        lines.append(f"| {label} base-prompt | {prompt:.2f} "
                     f"(Δпромпт {delta(prompt, none)}) |")
    if facts_tuned:
        t = facts_tuned["tuned"]["exact_acc"]
        b = facts_tuned["base-none"]["exact_acc"]
        lines.append(f"| 1.5b-tuned, факты в контексте (RAG-режим) | {t:.2f} "
                     f"(base-no-context {b:.2f}) |")
    lines += ["", "## Стиль-тон (day-08 s4)", "", "| Модель | score avg |",
              "|---|---|"]
    for name, modes in sorted(style_rows.items()):
        none = modes.get("base-none", {}).get("score_avg")
        prompt = modes.get("base-prompt", {}).get("score_avg")
        tuned = modes.get("tuned", {}).get("score_avg")
        row = f"| {name} | "
        parts = []
        if none is not None:
            parts.append(f"base-none {none:.2f}")
        if prompt is not None:
            parts.append(f"base-prompt {prompt:.2f} (Δ {delta(prompt, none)})")
        if tuned is not None:
            parts.append(f"tuned {tuned:.2f} (Δ {delta(tuned, none)})")
        lines.append(row + "; ".join(parts) + " |")
    lines += [
        "",
        "## Выводы", "",
        "1. **Формат** — оба рычага работают: промпт вытягивает parse_ok "
        "(0.00 → 0.33), тюн добавляет точность полей (0.00 → 0.47, "
        "Δтюн > Δпромпт по full_match).",
        "2. **Факты** — живут в контексте, а не в весах: без контекста base "
        "набирает 0.00 у обеих моделей; подстановка фактов в промпт даёт "
        "+0.58…+0.69; тюненая модель в RAG-режиме сохраняет чтение фактов "
        "(0.62 — на уровне base-prompt 0.58 в другом рантайме).",
        "3. **Стиль-тон** — промпт помогает не всегда (1.5B: −0.08; 7B: "
        "+0.11); тюн на todo-стиле не переносится на стиль (Δ −0.07, см. "
        "out-of-domain).",
        "",
        "Правило дня: формат и повторяющиеся паттерны → тюн; факты и "
        "контекст → промпт/RAG; стиль → промпт (тюн не окупается).",
    ]
    report = out_dir / "tasks_report.md"
    report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"OK -> {report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
