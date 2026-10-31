# День 7 (футбольный трек): генерация train/valid для задачи NL -> JSON.
# Gold строится вместе с текстом (по построению) — ручная разметка не нужна
# для train; eval-набор (30 кейсов) размечен руками в gen_eval.py.
#
# Счёт ВСЕГДА от домашней команды (дом:гости) — зафиксировано в system prompt
# и few-shot базовой модели. venue результата = стадион домашней команды.
#
# Запуск: python generate_data.py

import hashlib
import json
import random
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from seeds import (CLUB_DAT, CLUB_GEN, CLUBS, COMPETITIONS, COMPETITIONS_GEN,
                   COMP_WEIGHTS, DAYS, PLAYERS_TRAIN, STADIUM)


def gen(club):
    return CLUB_GEN.get(club, club)


def dat(club):
    return CLUB_DAT.get(club, club)

ROOT = Path(__file__).resolve().parent
SEED = 42


def canon(home, away, hs, aws, scorers, comp, venue):
    return {
        "home": home, "away": away,
        "home_score": hs, "away_score": aws,
        "scorers": sorted(scorers, key=lambda s: (s["minute"], s["team"], s["player"])),
        "competition": comp, "venue": venue,
    }


def gold_json(g):
    return json.dumps(g, ensure_ascii=False, separators=(",", ":"))


def comp_pick(rng):
    x = rng.random()
    acc = 0.0
    for name, w in COMP_WEIGHTS:
        acc += w
        if x <= acc:
            return name
    return COMP_WEIGHTS[-1][0]


def minute_str(rng, m):
    return rng.choice([f"{m}′", f"на {m}-й минуте"])


def scorers_str(rng, events):
    """events: список {'player','minute'} одного клуба (>=1). Без префикса
    клуба — его добавляет goals_clause."""
    by_player = {}
    for e in events:
        by_player.setdefault(e["player"], []).append(e["minute"])
    parts = []
    for p, mins in by_player.items():
        mins = sorted(mins)
        label = {2: "дубль", 3: "хет-трик", 4: "покер"}.get(len(mins))
        if label is None:
            parts.append(f"{p} ({minute_str(rng, mins[0])})")
        else:
            joined = " ".join(f"{minute_str(rng, m)}," for m in mins[:-1])
            parts.append(f"{p} оформил {label} ({joined} "
                         f"{minute_str(rng, mins[-1])})")
    if len(parts) == 1:
        return parts[0]
    return ", ".join(parts[:-1]) + " и " + parts[-1] if len(parts) > 2 \
        else " и ".join(parts)


def goals_clause(rng, home, away, h_ev, a_ev):
    chunks = []
    if h_ev:
        s = scorers_str(rng, h_ev)
        if "оформил" in s:
            chunks.append(f"«{home}» — {s}")
        else:
            verb = "отличился" if len(h_ev) == 1 else "отличились"
            chunks.append(f"у «{home}» {verb} {s}")
    if a_ev:
        s = scorers_str(rng, a_ev)
        chunks.append(f"у «{gen(away)}» — {s}")
    if not chunks:
        return "Голов не забили — вратари сохранили сухие листы."
    return "Голы: " + "; ".join(chunks) + "."


def make_scorers(rng, home, away, hs, aws):
    ev_h, ev_a = [], []
    used_min = set()
    for team, n in ((home, hs), (away, aws)):
        pool = PLAYERS_TRAIN[team]
        for _ in range(n):
            m = rng.randint(1, 90)
            while m in used_min:
                m = rng.randint(1, 90)
            used_min.add(m)
            p = rng.choice(pool)
            e = {"team": team, "player": p, "minute": m}
            (ev_h if team == home else ev_a).append(e)
    return ev_h, ev_a


def make_result(rng):
    home, away = rng.sample(CLUBS, 2)
    comp = comp_pick(rng)
    comp_prep = rng.choice(COMPETITIONS[comp])
    venue = STADIUM[home]
    hs = rng.choices(range(5), weights=[6, 22, 30, 22, 12])[0]
    aws = rng.choices(range(5), weights=[10, 24, 30, 20, 9])[0]
    ev_h, ev_a = make_scorers(rng, home, away, hs, aws)
    clause = goals_clause(rng, home, away, ev_h, ev_a)
    score = f"{hs}:{aws}"
    diff = hs - aws
    if diff > 0:
        verb = ("разгромил" if diff >= 3
                else "минимально обыграл" if diff == 1
                else "обыграл")
    elif diff < 0:
        verb = "уступил"
    else:
        verb = "сыграл вничью с"

    kind = rng.random()
    q = lambda c: f"«{c}»"
    comp_gen = COMPETITIONS_GEN[comp]
    if verb == "сыграл вничью с":
        head = rng.choice([
            f"{q(home)} дома {verb} {q(away)} — {score}",
            f"{q(home)} {verb} {q(away)} — {score}",
            f"Матч {q(home)} — {q(away)} завершился вничью {score}",
            f"В матче {comp_gen} {q(home)} и {q(away)} разошлись миром — {score}",
        ])
    elif diff > 0:
        head = rng.choice([
            f"{q(home)} {verb} {q(away)} — {score}",
            f"{q(home)} дома {verb} {q(away)} ({score})",
            f"В матче {comp_gen} {q(home)} на «{venue}» {verb} {q(away)} со счётом {score}",
            f"{q(home)} в {comp_prep} {verb} {q(away)} со счётом {score}",
            f"На «{venue}» {q(home)} {verb} {q(away)} — {score}",
        ])
    else:
        head = rng.choice([
            f"{q(home)} дома {verb} «{dat(away)}» {score}",
            f"{q(home)} {verb} «{dat(away)}» — {score}",
            f"{q(away)} победил в гостях у «{gen(home)}» — {score}",
            f"В матче {comp_gen} {q(home)} на «{venue}» {verb} «{dat(away)}» ({score})",
        ])
    comp_tail = "" if (comp_prep in head or comp_gen in head) \
        else f" Матч прошёл в {comp_prep}."
    text = f"{head}. {clause}{comp_tail}".replace("..", ".").strip()
    return text, canon(home, away, hs, aws, ev_h + ev_a, comp, venue)


def make_preview(rng):
    home, away = rng.sample(CLUBS, 2)
    comp = comp_pick(rng)
    comp_prep = rng.choice(COMPETITIONS[comp])
    comp_gen = COMPETITIONS_GEN[comp]
    day = rng.choice(DAYS)
    venue = STADIUM[home]
    text = rng.choice([
        f"В {day} «{home}» примет «{away}» в матче {comp_gen}.",
        f"«{away}» в {day} сыграет на выезде с «{home}» в {comp_prep}.",
        f"В {day} на «{venue}» состоится матч {comp_gen}: «{home}» — «{away}».",
        f"«{home}» объявил о матче с «{away}» в {comp_prep} — игра пройдёт в {day}.",
        f"Состоится матч {comp_gen}: «{home}» — «{away}».",
    ])
    return text, canon(home, away, None, None, [], comp, venue)


def build(n, seed, preview_share=0.14):
    rng = random.Random(seed)
    out, seen = [], set()
    attempts = 0
    while len(out) < n and attempts < n * 60:
        attempts += 1
        text, gold = (make_preview(rng) if rng.random() < preview_share
                      else make_result(rng))
        if text in seen:
            continue
        seen.add(text)
        out.append({"messages": [
            {"role": "user", "content": text},
            {"role": "assistant", "content": gold_json(gold)}],
            "kind": "preview" if gold["home_score"] is None else "result"})
    if len(out) < n:
        raise RuntimeError(f"сгенерировано {len(out)} < {n}")
    return out


def split_key(example):
    h = hashlib.sha256(f"{SEED}:{example['messages'][0]['content']}".encode())
    return int(h.hexdigest()[:12], 16) / 16 ** 12


def main():
    all_rows = build(360, SEED)
    train = [r for r in all_rows if split_key(r) < 0.88]
    valid = [r for r in all_rows if split_key(r) >= 0.88]
    for path, rows in ((ROOT / "data" / "train.jsonl", train),
                       (ROOT / "data" / "valid.jsonl", valid)):
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
    stats = {
        "seed": SEED, "train": len(train), "valid": len(valid),
        "preview_share": round(sum(1 for r in all_rows if r["kind"] == "preview")
                               / len(all_rows), 3),
    }
    (ROOT / "data" / "stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(stats, ensure_ascii=False, indent=2))
    print("train пример:", train[0]["messages"][0]["content"])
    print("train gold:  ", train[0]["messages"][1]["content"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
