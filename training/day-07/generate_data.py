# Генерация датасета day-07: сиды (seeds.py) + экспансия + входы от LLM
# (локальная Ollama) с rule-валидацией gold, чистка (дедуп, почти-дубли,
# баланс, единый формат), защита от утечки eval-кейсов, сплит train/valid.
#
# Выход:
#   data/train.jsonl, data/valid.jsonl  — messages-формат (system/user/assistant)
#   data/stats.json                     — честная статистика чистки
#   data/rejected.jsonl                 — отклонённые LLM-кандидаты (для ревизии)
#
# Запуск: python generate_data.py [--llm-model qwen3:4b] [--llm-batches 30]
# LLM-часть опциональна: --no-llm собирает датасет только из сидов.

import argparse
import difflib
import json
import random
import re
import time
import urllib.request
from pathlib import Path

from seeds import (EVAL_ACTIONS, SEED_CALLS, SYSTEM_PROMPT, compact, gold)

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
EVAL_FILE = ROOT / "eval" / "eval_set.jsonl"

RECURRING = (None, "daily", "weekly", "hourly")

# Слова-маркеры расписания: в text их быть не должно (они про "когда", не "что")
SCHED_WORDS = re.compile(
    r"каждый\w*|ежедневно|ежечасно|еженедельно|раз в \d+|по (понедельникам|"
    r"вторникам|средам|четвергам|пятницам|субботам|воскресеньям)|"
    r"^напоминай\b|^напомни\b|^не забудь\b|^нужно\b|^пора\b|^надо\b",
    re.IGNORECASE,
)
DAY_WORD = re.compile(
    r"понедельник\w*|вторник\w*|среда|среду|средам|четверг\w*|пятниц\w*|"
    r"суббот\w*|воскресень\w*",
    re.IGNORECASE,
)
HOUR_WORD = re.compile(r"час\w*|ежечасно|каждый час", re.IGNORECASE)
# Число в словесной форме -> цифры (для «каждые два часа»)
RU_NUM = {"один": 1, "два": 2, "три": 3, "четыре": 4, "шесть": 6,
          "восемь": 8, "двенадцать": 12, "двадцать четыре": 24}
MINUTES_WORD = re.compile(r"минут\w*|полчаса|пол-часа|получаса", re.IGNORECASE)
DAILY_WORD = re.compile(
    r"каждый день|каждое утро|каждый вечер|ежедневно|по утрам|по вечерам",
    re.IGNORECASE,
)

LLM_CATEGORIES = (
    "дом, растения, питомцы, кухня",
    "работа и проекты: код, отчёты, созвоны",
    "блог и контент: посты, статистика, комментарии",
    "здоровье: сон, разминка, вода, прогулки",
    "финансы: счета, оплаты, бюджеты",
    "учёба и книги: главы, слова, конспекты",
)


def norm_text(s: str) -> str:
    """Ключ дедупликации: нижний регистр, без пунктуации, сжатые пробелы."""
    s = re.sub(r"[^\w\s]", " ", s.lower(), flags=re.UNICODE)
    return re.sub(r"\s+", " ", s).strip()


def load_eval_inputs() -> list[str]:
    with open(EVAL_FILE, encoding="utf-8") as f:
        return [json.loads(line)["input"] for line in f if line.strip()]


# --- Rule-валидация LLM-кандидатов -----------------------------------

def validate_candidate(cand: dict, input_str: str) -> tuple[bool, str]:
    """(ok, причина) — консистентность gold с текстом и гигиена text."""
    if not isinstance(cand, dict):
        return False, "gold не объект"
    text = cand.get("text")
    rec = cand.get("recurring")
    dow = cand.get("day_of_week")
    ihr = cand.get("interval_hours")
    if not isinstance(text, str) or not (2 <= len(text) <= 90):
        return False, "text пустой/длинный"
    if rec not in RECURRING:
        return False, f"recurring={rec!r}"
    if SCHED_WORDS.search(text):
        return False, "text содержит слова о расписании/префикс"
    if re.match(r"^(про|о|об)\s", text, re.IGNORECASE):
        return False, "text начинается с предлога (висячий «про …»)"
    if norm_text(text) == norm_text(input_str) and rec is not None:
        return False, "text == input при recurring!=null (нет чистки)"
    if rec == "weekly":
        if not isinstance(dow, int) or not 0 <= dow <= 6:
            return False, f"dow={dow!r}"
        if ihr is not None or not DAY_WORD.search(input_str):
            return False, "weekly: interval задан или нет слова дня"
    elif rec == "daily":
        if dow is not None or ihr is not None:
            return False, "daily: лишние поля"
        if not DAILY_WORD.search(input_str):
            return False, "daily: нет маркера ежедневности"
    elif rec == "hourly":
        if not isinstance(ihr, int) or ihr < 1:
            return False, f"interval={ihr!r}"
        if dow is not None or not HOUR_WORD.search(input_str):
            return False, "hourly: dow задан или нет слова часов"
        if MINUTES_WORD.search(input_str):
            return False, "hourly: минуты/полчаса вне схемы"
        if ihr == 1:
            if not re.search(r"каждый час|ежечасно|раз в час\b", input_str, re.IGNORECASE):
                return False, "hourly/1: нет явного «каждый час/ежечасно»"
        else:
            m = re.search(r"(?:каждые|раз в)\s+(\d+)", input_str, re.IGNORECASE)
            n_word = next((v for k, v in RU_NUM.items()
                           if re.search(r"(?:каждые|раз в)\s+" + k, input_str, re.IGNORECASE)),
                          None)
            n = m.group(1) if m else n_word
            if n is None or int(n) != ihr:
                return False, f"hourly: число во входе ({n}) != interval ({ihr})"
    else:  # rec is None — вход не должен содержать НИКАКИХ маркеров повтора
        if dow is not None or ihr is not None:
            return False, "none: лишние поля"
        if DAILY_WORD.search(input_str):
            return False, "none: есть маркер ежедневности"
        if DAY_WORD.search(input_str):
            return False, "none: есть маркер дня недели"
        if re.search(r"кажд\w+ \d* ?час", input_str, re.IGNORECASE):
            return False, "none: есть маркер часов"
    return True, ""


# --- LLM-генерация (локальная Ollama, native API, think=false) --------

GEN_SYSTEM = (
    "Ты помогаешь собрать обучающий датасет для конвертера "
    "«текст задачи -> JSON планировщика». Возвращаешь ровно один JSON-массив, "
    "без пояснений и markdown."
)


def gen_prompt(batch_no: int, k: int) -> str:
    cats = "；".join(LLM_CATEGORIES)
    return f"""Батч {batch_no}. Придумай {k} РАЗНЫХ формулировок задач на русском (как человек пишет в чате боту) с полями gold.

Требования к input:
- живые разговорные формулировки: «напоминай…», «каждый вторник…», «раз в 3 часа…», «ежедневно…», «не забудь…», без расписания тоже можно;
- темы по кругу: {cats};
- НЕ используй действия из списка: {", ".join(EVAL_ACTIONS)};
- в input слова о расписании ОБЯЗАТЕЛЬНО есть, если gold.recurring не null.

Требования к gold:
- "text": строгое действие, СТРОГО без слов о расписании («каждый», «ежедневно», «напоминай», «не забудь», «нужно», «пора») и без слов дня/часа; время дня (в 20:00) можно оставить;
- "recurring": null|"daily"|"weekly"|"hourly";
- "day_of_week": null или 0-6 (0=воскресенье, 1=понедельник, …, 6=суббота), только для weekly;
- "interval_hours": null или целое >= 1, только для hourly.

Классы в батче: 2 input с recurring=null, 2 daily, 2 weekly (разные дни), 2 hourly (разные интервалы).
Формат ответа: [{{"input": "...", "gold": {{"text": "...", "recurring": "...", "day_of_week": null, "interval_hours": null}}}}, …]"""


def ollama_chat(model: str, system: str, user: str, timeout: int = 180) -> str:
    body = json.dumps({
        "model": model,
        "messages": [{"role": "system", "content": system},
                     {"role": "user", "content": user}],
        "stream": False,
        "think": False,
        "options": {"temperature": 0.9, "num_predict": 2200},
    }).encode("utf-8")
    req = urllib.request.Request(
        "http://localhost:11434/api/chat", data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["message"]["content"]


def parse_array(raw: str) -> list:
    """Вытащить первый JSON-массив из ответа модели."""
    start = raw.find("[")
    if start == -1:
        raise ValueError("нет '[' в ответе")
    depth = 0
    for i in range(start, len(raw)):
        if raw[i] == "[":
            depth += 1
        elif raw[i] == "]":
            depth -= 1
            if depth == 0:
                return json.loads(raw[start:i + 1])
    raise ValueError("массив не закрыт")


def generate_llm_inputs(model: str, batches: int, per_batch: int,
                        rng: random.Random) -> tuple[list[dict], list[dict], dict]:
    """Возвращает (принятые, отклонённые, статистика)."""
    accepted: list[dict] = []
    rejected: list[dict] = []
    seen_inputs: set[str] = set()
    stats = {"batches": 0, "parse_fail": 0, "candidates": 0, "accepted": 0,
             "rejected_rules": 0, "rejected_dup": 0}
    for b in range(1, batches + 1):
        try:
            raw = ollama_chat(model, GEN_SYSTEM, gen_prompt(b, per_batch))
            arr = parse_array(raw)
        except Exception as e:  # noqa: BLE001 — счётчик, не глушим молча
            stats["parse_fail"] += 1
            print(f"[batch {b}] parse fail: {e}")
            continue
        stats["batches"] += 1
        for item in arr:
            stats["candidates"] += 1
            if not isinstance(item, dict) or "input" not in item or "gold" not in item:
                rejected.append({"reason": "нет input/gold", "item": item})
                stats["rejected_rules"] += 1
                continue
            input_str = str(item["input"]).strip()
            ok, why = validate_candidate(item["gold"], input_str)
            if not ok:
                rejected.append({"reason": why, "item": item})
                stats["rejected_rules"] += 1
                continue
            key = norm_text(input_str)
            if key in seen_inputs:
                rejected.append({"reason": "дубль input", "item": item})
                stats["rejected_dup"] += 1
                continue
            seen_inputs.add(key)
            accepted.append({"input": input_str,
                             "gold": gold(item["gold"]["text"], item["gold"]["recurring"],
                                          item["gold"]["day_of_week"],
                                          item["gold"]["interval_hours"]),
                             "source": "llm"})
            stats["accepted"] += 1
        if b % 5 == 0:
            print(f"[batch {b}/{batches}] accepted={stats['accepted']} "
                  f"rejected={stats['rejected_rules']} dup={stats['rejected_dup']}")
    return accepted, rejected, stats


# --- Чистка и сплит ---------------------------------------------------

def near_dup(a: str, b: str, threshold: float = 0.92) -> bool:
    return difflib.SequenceMatcher(None, a, b).ratio() >= threshold


def dedupe_near(pool: list[dict], threshold: float = 0.92) -> tuple[list[dict], int]:
    """Убирает почти-дубли по нормализованному input (жадный первый-победил)."""
    kept: list[dict] = []
    keys: list[str] = []
    dropped = 0
    for item in pool:
        key = norm_text(item["input"])
        if any(near_dup(key, k, threshold) for k in keys):
            dropped += 1
            continue
        keys.append(key)
        kept.append(item)
    return kept, dropped


def drop_eval_leak(pool: list[dict], eval_norms: list[str]) -> tuple[list[dict], int]:
    """Убирает примеры, близкие к eval-кейсам (утечка)."""
    kept = []
    dropped = 0
    for item in pool:
        key = norm_text(item["input"])
        if any(near_dup(key, e, 0.90) for e in eval_norms):
            dropped += 1
            continue
        kept.append(item)
    return kept, dropped


def to_messages(item: dict) -> dict:
    return {"messages": [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": item["input"]},
        {"role": "assistant", "content": compact(item["gold"])},
    ]}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--llm-model", default="qwen2.5:7b-instruct")
    ap.add_argument("--llm-batches", type=int, default=30)
    ap.add_argument("--per-batch", type=int, default=8)
    ap.add_argument("--no-llm", action="store_true")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    rng = random.Random(args.seed)

    eval_inputs = load_eval_inputs()
    eval_norms = [norm_text(s) for s in eval_inputs]

    # 1. Сиды (gold по построению)
    pool: list[dict] = []
    for fn, slots in SEED_CALLS:
        inp, g, tag = fn(*slots)
        pool.append({"input": inp, "gold": g, "source": tag})
    seeds_total = len(pool)

    # 2. LLM-входы (реальный локальный прогон)
    llm_stats: dict = {"skipped": True}
    if not args.no_llm:
        t0 = time.time()
        acc, rej, llm_stats = generate_llm_inputs(
            args.llm_model, args.llm_batches, args.per_batch, rng)
        llm_stats["wall_sec"] = round(time.time() - t0, 1)
        pool.extend(acc)
        with open(DATA / "rejected.jsonl", "w", encoding="utf-8") as f:
            for r in rej:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")

    # 3. Чистка: точные дубли -> почти-дубли -> утечка eval
    seen: set[str] = set()
    exact_dup = 0
    clean: list[dict] = []
    for item in pool:
        key = norm_text(item["input"])
        if key in seen:
            exact_dup += 1
            continue
        seen.add(key)
        clean.append(item)
    clean, near_dropped = dedupe_near(clean)
    clean, leak_dropped = drop_eval_leak(clean, eval_norms)

    # 4. Разброс классов (баланс)
    by_class: dict[str, int] = {str(k): 0 for k in RECURRING}
    for item in clean:
        by_class[str(item["gold"]["recurring"])] += 1

    # 5. Сплит
    rng.shuffle(clean)
    n_valid = max(30, int(len(clean) * 0.12))
    valid, train = clean[:n_valid], clean[n_valid:]

    DATA.mkdir(exist_ok=True)
    with open(DATA / "train.jsonl", "w", encoding="utf-8") as f:
        for item in train:
            f.write(json.dumps(to_messages(item), ensure_ascii=False) + "\n")
    with open(DATA / "valid.jsonl", "w", encoding="utf-8") as f:
        for item in valid:
            f.write(json.dumps(to_messages(item), ensure_ascii=False) + "\n")

    stats = {
        "seeds_total": seeds_total,
        "llm": llm_stats,
        "pool_total": len(pool),
        "exact_dup_dropped": exact_dup,
        "near_dup_dropped": near_dropped,
        "eval_leak_dropped": leak_dropped,
        "final_total": len(clean),
        "train": len(train),
        "valid": len(valid),
        "by_class_total": by_class,
        "near_dup_threshold": 0.92,
        "seed": args.seed,
    }
    with open(DATA / "stats.json", "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)
    print(json.dumps(stats, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
