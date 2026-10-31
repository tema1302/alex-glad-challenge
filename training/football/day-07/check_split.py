# День 7 (футбольный трек): контроль сплитов.
# Проверяет: точные дубли текста внутри train и между сплитами,
# непересечение игроков train/eval (где заявлен PLAYERS_EVAL),
# баланс: competition, результат/превью, победа дома/в гостях/ничья.
#
# Запуск: python check_split.py

import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from seeds import PLAYERS_EVAL, PLAYERS_TRAIN

ROOT = Path(__file__).resolve().parent


def load(p):
    return [json.loads(l) for l in open(p, encoding="utf-8") if l.strip()]


def players_of(rows, key="messages"):
    names = set()
    for r in rows:
        payload = r["messages"][1]["content"] if key == "messages" else r["gold"]
        gold = json.loads(payload)
        for s in gold["scorers"]:
            names.add(s["player"])
    return names


def texts_of(rows, key="messages"):
    if key == "messages":
        return [r["messages"][0]["content"] for r in rows]
    return [r["prompt"] for r in rows]


def main():
    train = load(ROOT / "data" / "train.jsonl")
    valid = load(ROOT / "data" / "valid.jsonl")
    eval_rows = load(ROOT / "eval" / "eval.jsonl")
    problems = []

    texts_train = texts_of(train)
    if len(texts_train) != len(set(texts_train)):
        problems.append("точные дубли текста внутри train")
    eval_texts = set(texts_of(eval_rows, key="prompt"))
    if eval_texts & set(texts_train):
        problems.append("пересечение текста eval и train")

    tr_players = players_of(train + valid)
    ev_players = players_of(eval_rows, key="prompt")
    overlap = tr_players & ev_players
    if overlap:
        problems.append(f"пересечение игроков train/eval: {sorted(overlap)}")
    # игроки eval должны быть из PLAYERS_EVAL (с инициалами или без —
    # в eval-текстах имена пишутся коротко, gold следует тексту)
    known_eval = {p for v in PLAYERS_EVAL.values() for p in v}
    short = {p.split(". ", 1)[-1] for p in known_eval}
    unknown = ev_players - known_eval - short
    if unknown:
        problems.append(f"в eval голы игроков вне PLAYERS_EVAL: {sorted(unknown)}")
    known_train = {p for v in PLAYERS_TRAIN.values() for p in v}
    bad_train = tr_players - known_train
    if bad_train:
        problems.append(f"в train игроки вне PLAYERS_TRAIN: {sorted(bad_train)}")

    comp = Counter(json.loads(r["messages"][1]["content"])["competition"]
                   for r in train + valid)
    kinds = Counter(r.get("kind") for r in train + valid)
    results = [json.loads(r["messages"][1]["content"]) for r in train + valid
               if r.get("kind") == "result"]
    outcomes = Counter("home_win" if g["home_score"] > g["away_score"]
                       else "away_win" if g["home_score"] < g["away_score"]
                       else "draw" for g in results)
    scores = Counter(f"{g['home_score']}:{g['away_score']}" for g in results)
    report = {
        "train": len(train), "valid": len(valid), "eval": len(eval_rows),
        "duplicate_texts_in_train": len(texts_train) - len(set(texts_train)),
        "competition_balance": dict(comp),
        "kinds": dict(kinds),
        "outcomes": dict(outcomes),
        "top_scores": dict(scores.most_common(8)),
        "problems": problems,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
