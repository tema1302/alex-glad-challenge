# День-09 s4 (#177): сравнение трёх вариантов — ученик до / ученик после /
# учитель. Собирает code.json трёх прогонов в единый отчёт compare.md.
# Запуск: python compare.py --out ../../docs/advanced-day-09/eval

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT / ".." / ".."

SOURCES = {
    "student-before (coder:1.5b-base, Ollama)":
        "docs/advanced-day-09/eval/1.5b-base/code.json",
    "student-after (distilled adapter, Kaggle T4)":
        "docs/advanced-day-09/eval/student-t4/code.json",
    "teacher (coder:7b, Ollama)":
        "docs/advanced-day-09/eval/7b/code.json",
}

# Оценочная стоимость запроса: VRAM (GGUF Q4_K_M ≈) и вес модели — прокси
# «цены» запуска; latency — из замеров (внутри своего рантайма).
COST = {
    "student-before (coder:1.5b-base, Ollama)": {"params": "1.5B", "vram_gb": 1.2},
    "student-after (distilled adapter, Kaggle T4)": {"params": "1.5B + LoRA", "vram_gb": 1.2},
    "teacher (coder:7b, Ollama)": {"params": "7B", "vram_gb": 4.7},
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    rows = {}
    for label, rel in SOURCES.items():
        p = REPO / rel
        rows[label] = json.loads(p.read_text(encoding="utf-8"))

    lines = [
        "# Дистилляция: ученик до / ученик после / учитель (day-09 s4)", "",
        "30 eval-задач (спецификация → Python-функция), pass@1 = все тесты "
        "задачи зелёные. temperature=0, seed=42.", "",
        "| Вариант | pass@1 | latency avg | вес | VRAM (оценка) |",
        "|---|---|---|---|---|",
    ]
    for label, s in rows.items():
        c = COST[label]
        lines.append(
            f"| {label} | {s['pass1']}/{s['n']} ({s['pass1_acc']:.0%}) | "
            f"{s['latency_avg_ms']} мс | {c['params']} | ~{c['vram_gb']} ГБ |")
    lines += [
        "",
        "## Чтение результатов", "",
        "- Качество: учитель 27/30 > ученик до 24/30 > ученик после 18/30. "
        "Дистилляция на пуле из 107 лёгких примеров **не перенеслась** на "
        "невиданные задачи — обучение дало train loss 0.0 (зазубривание).",
        "- Рантаймы разные (Ollama vs transformers на T4), поэтому 24 vs 18 — "
        "не строгое сравнение; но падение на 6 задач при таком же наборе и "
        "prompt'е указывает на регресс, а не на шум рантайма.",
        "- Скорость: ученик (1.5B) в Ollama ~1.3× быстрее учителя (2.4 с "
        "против 3.1 с на задачу); на T4 transformers-ученик медленнее "
        "(3–7 с/задачу) — рантайм не оптимизирован, в прод так не кладём.",
        "- Стоимость: ученик требует ~1.2 ГБ VRAM против ~4.7 ГБ у учителя — "
        "4× экономия по памяти и право жить на слабом железе.",
        "",
        "## Вывод", "",
        "Ученик пока **не заменяет** учителя: на unseen-задачах он хуже даже "
        "base. Гипотезы почему: (1) пул учителя слишком лёгкий (accept 100%, "
        "учитель не ошибается — ученику нечему учиться в «сложности»); "
        "(2) 107 примеров → memorization без генерализации; (3) eval-набор "
        "сложнее пула по построению.", "",
        "Рычаги (приоритет): 1) train-пул посложнее и разнообразнее "
        "(hard-mining: задачи, где base падает); 2) ранняя остановка/меньше "
        "эпох при следящем eval на задачах-призраках (holdout из eval-"
        "дистрибуции); 3) меньше ёмкости LoRA (r=8) против зазубривания; "
        "4) семплирование учителя при temperature>0 для разнообразия.", "",
    ]
    report = out_dir / "compare.md"
    report.write_text("\n".join(lines), encoding="utf-8")
    print(f"OK -> {report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
