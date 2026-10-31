# День 9 (футбольный трек): rule-скорер репортажей (общий для генерации
# учителя и оценки ученика). Проверяет, что текст содержит все факты JSON.

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "day-07"))
from seeds import COMPETITIONS  # noqa: E402

REPORT_MAX_CHARS = 260


def _score_variants(task: dict) -> list[str]:
    hs, aws = task["home_score"], task["away_score"]
    out = []
    for a, b in ((hs, aws), (aws, hs)):  # обе ориентации: репортажи пишут
        s = f"{a}:{b}"                   # и от домашних, и от победителя
        out += [s, s.replace(":", "-"), s.replace(":", "—"), s.replace(":", "–")]
    return out


def facts_present(task: dict, text: str) -> bool:
    t = text.lower()
    if len(text) > REPORT_MAX_CHARS:
        return False
    if task["home"].lower() not in t or task["away"].lower() not in t:
        return False
    compact = text.replace(" ", "")
    if task["home_score"] is not None and \
            not any(v in compact for v in _score_variants(task)):
        return False
    variants = [task["competition"]] + COMPETITIONS.get(task["competition"], [])
    if not any(v.lower() in t for v in variants):
        return False
    for e in task["scorers"]:
        if e["player"].lower() not in t or str(e["minute"]) not in text:
            return False
    return True


def missing_facts(task: dict, text: str) -> list[str]:
    """Что именно не нашлось (для отладки отклонённых сэмплов)."""
    t = text.lower()
    miss = []
    if len(text) > REPORT_MAX_CHARS:
        miss.append(f"len>{REPORT_MAX_CHARS}")
    for club in (task["home"], task["away"]):
        if club.lower() not in t:
            miss.append(f"club:{club}")
    compact = text.replace(" ", "")
    if task["home_score"] is not None and \
            not any(v in compact for v in _score_variants(task)):
        miss.append(f"score:{task['home_score']}:{task['away_score']}")
    variants = [task["competition"]] + COMPETITIONS.get(task["competition"], [])
    if not any(v.lower() in t for v in variants):
        miss.append(f"comp:{task['competition']}")
    for e in task["scorers"]:
        if e["player"].lower() not in t:
            miss.append(f"player:{e['player']}")
        elif str(e["minute"]) not in text:
            miss.append(f"minute:{e['player']}:{e['minute']}")
    return miss
