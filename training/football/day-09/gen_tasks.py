# День 9 (футбольный трек): задачи для дистилляции «JSON -> короткий репортаж».
# Train-пул (120) строится на PLAYERS_TRAIN (как day-07), eval (30) — на
# PLAYERS_EVAL, пересечений нет (assert). Формат задачи: пользователь даёт
# JSON матча, ассистент пишет 1–2 предложения репортажа. Качество проверяется
# rule-скорером (eval_report.py): все факты из JSON упомянуты, лимит длины.
#
# Запуск: python gen_tasks.py

import hashlib
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "day-07"))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from seeds import CLUBS, COMPETITIONS, COMP_WEIGHTS, PLAYERS_EVAL, \
    PLAYERS_TRAIN, STADIUM

ROOT = Path(__file__).resolve().parent
SEED = 42


def comp_pick(rng):
    x = rng.random()
    acc = 0.0
    for name, w in COMP_WEIGHTS:
        acc += w
        if x <= acc:
            return name
    return "АПЛ"


def make_task(rng, players):
    home, away = rng.sample([c for c in CLUBS if c in players], 2) \
        if len(players) >= 8 else rng.sample(CLUBS, 2)
    comp = comp_pick(rng)
    hs = rng.choices(range(4), weights=[8, 26, 34, 20])[0]
    aws = rng.choices(range(4), weights=[12, 30, 32, 18])[0]
    ev = []
    used = set()
    for team, n in ((home, hs), (away, aws)):
        pool = players.get(team) or ["игрок"]
        for _ in range(n):
            m = rng.randint(1, 90)
            while m in used:
                m = rng.randint(1, 90)
            used.add(m)
            ev.append({"team": team, "player": rng.choice(pool), "minute": m})
    task = {"home": home, "away": away, "home_score": hs, "away_score": aws,
            "scorers": sorted(ev, key=lambda e: (e["minute"], e["team"])),
            "competition": comp, "venue": STADIUM[home]}
    return task


def key(task):
    h = hashlib.sha256(f"{SEED}:{json.dumps(task, sort_keys=True, ensure_ascii=False)}".encode())
    return int(h.hexdigest()[:12], 16) / 16 ** 12


def main():
    rng = random.Random(SEED)
    train, evals, seen = [], [], set()
    while len(evals) < 30:
        t = make_task(rng, PLAYERS_EVAL)
        s = json.dumps(t, sort_keys=True, ensure_ascii=False)
        if s in seen:
            continue
        seen.add(s)
        evals.append(t)
    while len(train) < 120:
        t = make_task(rng, PLAYERS_TRAIN)
        s = json.dumps(t, sort_keys=True, ensure_ascii=False)
        if s in seen:
            continue
        seen.add(s)
        train.append(t)

    # assert: игроки train/eval не пересекаются
    tr = {e["player"] for t in train for e in t["scorers"]}
    ev = {e["player"] for t in evals for e in t["scorers"]}
    assert not (tr & ev), f"пересечение игроков: {tr & ev}"

    ROOT.joinpath("data").mkdir(exist_ok=True)
    with open(ROOT / "data" / "train_tasks.json", "w", encoding="utf-8") as f:
        json.dump(train, f, ensure_ascii=False, indent=1)
    with open(ROOT / "data" / "eval_tasks.json", "w", encoding="utf-8") as f:
        json.dump(evals, f, ensure_ascii=False, indent=1)
    print(f"train tasks: {len(train)}, eval tasks: {len(evals)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
