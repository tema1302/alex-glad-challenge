# День 6/7 (футбольный трек): loss.csv + val_loss.csv -> loss.svg.
# Без зависимостей (в venv нет matplotlib) — полилинии вручную в SVG.

import csv
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent


def read_csv(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def polyline(points, x0, y0, w, h, xmin, xmax, ymin, ymax):
    pts = []
    for x, y in points:
        px = x0 + (x - xmin) / max(1e-9, (xmax - xmin)) * w
        py = y0 + h - (y - ymin) / max(1e-9, (ymax - ymin)) * h
        pts.append(f"{px:.1f},{py:.1f}")
    return " ".join(pts)


def main():
    train = [(int(r["step"]), float(r["train_loss"]))
             for r in read_csv(ROOT / "artifacts" / "loss.csv")]
    val_path = ROOT / "artifacts" / "val_loss.csv"
    val = [(int(r["epoch"]), float(r["val_loss"]))
           for r in read_csv(val_path)] if val_path.exists() else []

    W, H, x0, y0 = 860, 420, 60, 30
    all_y = [y for _, y in train] + [y for _, y in val]
    ymin, ymax = 0.0, max(all_y) * 1.1
    xmax = max(train, key=lambda p: p[0])[0]
    # вал-лосс от эпохи -> на шкалу шагов (эпоха ≈ steps/epochs)
    epochs = max(1, val[-1][0]) if val else 1
    steps_per_epoch = xmax / epochs
    val_pts = [(e * steps_per_epoch, v) for e, v in val]

    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H+60}">',
           f'<rect width="100%" height="100%" fill="white"/>',
           f'<text x="{W/2}" y="20" text-anchor="middle" font-family="sans-serif" font-size="16">Day loss: train (blue) vs val (red)</text>',
           f'<rect x="{x0}" y="{y0}" width="{W-x0-20}" height="{H-y0-30}" fill="none" stroke="#999"/>',
           f'<polyline fill="none" stroke="#1f77b4" stroke-width="1.2" points="{polyline(train, x0, y0, W-x0-20, H-y0-30, 0, xmax, ymin, ymax)}"/>']
    if val_pts:
        svg.append(f'<polyline fill="none" stroke="#d62728" stroke-width="2" points="{polyline(val_pts, x0, y0, W-x0-20, H-y0-30, 0, xmax, ymin, ymax)}"/>')
        for e, v in val:
            svg.append(f'<text x="{x0 + (e*steps_per_epoch)/(xmax)*(W-x0-20):.0f}" y="{H-12}" text-anchor="middle" font-size="11" font-family="sans-serif">ep{e}</text>')
    svg.append(f'<text x="12" y="{y0+12}" font-size="11" font-family="sans-serif">{ymax:.2f}</text>')
    svg.append(f'<text x="12" y="{y0+H-30}" font-size="11" font-family="sans-serif">{ymin:.2f}</text>')
    svg.append("</svg>")
    out = ROOT / "artifacts" / "loss.svg"
    out.write_text("\n".join(svg), encoding="utf-8")
    print(f"-> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
