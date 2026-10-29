# Рисует loss.png из artifacts/loss.csv: train loss (линия) + eval loss (точки).
# Запуск (после train_qlora.py): python plot_loss.py
# Вход можно переопределить: python plot_loss.py path/to/loss.csv path/to/loss.png

import csv
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parent


def main() -> int:
    csv_path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "artifacts" / "loss.csv"
    png_path = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "artifacts" / "loss.png"
    if not csv_path.exists():
        print(f"no {csv_path} — сначала python train_qlora.py")
        return 1

    steps, train_l, eval_s, eval_l = [], [], [], []
    with open(csv_path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row.get("train_loss"):
                steps.append(int(row["step"]))
                train_l.append(float(row["train_loss"]))
            if row.get("eval_loss"):
                eval_s.append(int(row["step"]))
                eval_l.append(float(row["eval_loss"]))

    fig, ax = plt.subplots(figsize=(9, 5))
    if steps:
        ax.plot(steps, train_l, label="train loss", color="#4c72b0", linewidth=1.5)
    if eval_s:
        ax.plot(eval_s, eval_l, "o-", label="eval loss", color="#dd8452", linewidth=1.5)
    ax.set_xlabel("step")
    ax.set_ylabel("loss")
    ax.set_title("Day 6 — QLoRA text-to-SQL: train/eval loss")
    ax.grid(True, alpha=0.3)
    ax.legend()
    fig.tight_layout()
    png_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(png_path, dpi=140)
    print(f"written: {png_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
