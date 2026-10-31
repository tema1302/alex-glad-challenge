# День 8 (футбольный трек), s4: единый отчёт по трём типам задач.
# Собирает: формат (tuned day-07 vs base-prompt из tuned.json day-07),
# факты (facts_trained.json), стиль (style.json) — таблица «где тюн
# оправдан, а где промпт/RAG дешевле».
#
# Запуск: python tasks_report.py \
#   --day07-eval ../../../docs/advanced-day-07/football/eval \
#   --facts ../../../docs/advanced-day-08/football/eval/facts/facts_trained.json \
#   --style ../../../docs/advanced-day-08/football/eval/style/style.json \
#   --out ../../../docs/advanced-day-08/football/eval

import argparse
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--day07-eval", required=True)
    ap.add_argument("--facts", required=True)
    ap.add_argument("--style", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    tuned = json.loads(Path(args.day07_eval, "tuned.json").read_text(
        encoding="utf-8"))
    baseline = json.loads(Path(args.day07_eval, "baseline.json").read_text(
        encoding="utf-8"))
    facts = json.loads(Path(args.facts).read_text(encoding="utf-8"))
    style = json.loads(Path(args.style).read_text(encoding="utf-8"))

    fmt_tuned = tuned["modes"]["tuned"]["full_match"] / tuned["modes"]["tuned"]["n"]
    fmt_prompt_same = (tuned["modes"]["base-prompt"]["full_match"]
                       / tuned["modes"]["base-prompt"]["n"])
    fmt_prompt_oll = (baseline["modes"]["prompt"]["full_match"]
                      / baseline["modes"]["prompt"]["n"])
    fct = facts["modes"]
    fct_trained = (fct["trained-none-orig"]["exact"]
                   + fct["trained-none-para"]["exact"]) / (
        fct["trained-none-orig"]["n"] + fct["trained-none-para"]["n"])
    fct_prompt = fct["base-prompt"]["exact_acc"]
    st = style["modes"]

    lines = [
        "# Три типа задач: где тюн, где промпт (day-08 football)", "",
        "| Тип задачи | base-none | base-prompt (промпт) | tuned (тюн) | Вывод |",
        "|---|---|---|---|---|",
        f"| Формат (day-07 full_match, 30) | {baseline['modes']['none']['full_match']}/30 "
        f"| {fmt_prompt_same:.2f} (тот же рантайм) / {fmt_prompt_oll:.2f} (base-рантайм) "
        f"| **{fmt_tuned:.2f}** | тюн > промпт |",
        f"| Факты (exact, 72+36) | 0.00 (нет контекста) | {fct_prompt:.2f} (факты в промпте) "
        f"| {fct_trained:.2f} (обучена на фактах) | только промпт/RAG: веса ненадёжны |",
        f"| Стиль-тон (rule-score, 12) | {st['base-none']['avg']:.2f} "
        f"| {st['base-prompt']['avg']:.2f} | {st['tuned']['avg']:.2f} "
        "| тюн на JSON не переносится |",
        "",
        "## Чтение цифр",
        "",
        "- **Формат**: тюн выигрывает у промпта в одном рантайме "
        f"({fmt_tuned:.2f} vs {fmt_prompt_same:.2f}) и не требует few-shot в проде.",
        "- **Факты**: без контекста фактов нет ни у кого; обучение на фактах "
        "даёт recall ~2/3 и хрупкие формулировки — дешевле и надёжнее промпт/RAG.",
        "- **Стиль**: промпт помогает нестабильно; тюн парсера на стиль не "
        "переносится (иногда мешает).",
    ]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "tasks_report.md").write_text("\n".join(lines) + "\n",
                                         encoding="utf-8")
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
