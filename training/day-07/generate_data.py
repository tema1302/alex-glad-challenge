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

# --- Boundary-пунты (v9): вход ЗВУЧИТ как расписание, но gold = None ------
# Семейства ловушек из README дня; gold.text = вход дословно.
BOUNDARY_RES = (
    re.compile(r"\bкаждый \w+ и \w+\b", re.IGNORECASE),          # два дня
    re.compile(r"\bпо \w+ и \w+\b", re.IGNORECASE),
    re.compile(r"по выходным|на выходных|в выходные", re.IGNORECASE),
    re.compile(r"(?:каждые|раз в) \d+ минут", re.IGNORECASE),     # минуты
    re.compile(r"раз в \d+ (?:дня|дней)", re.IGNORECASE),        # интервал в днях
    re.compile(r"\bзавтра\b|\bпослезавтра\b|\bсегодня\b", re.IGNORECASE),  # отн. даты
    re.compile(r"\bдо (?:понедельник\w*|вторник\w*|сред\w*|четверг\w*|"
               r"пятниц\w*|суббот\w*|воскресень\w*)", re.IGNORECASE),  # дедлайн
    re.compile(r"\bв (?:понедельник|вторник|среду|четверг|"
               r"пятницу|субботу|воскресенье)\b", re.IGNORECASE),  # «в день» без периода
    re.compile(r"\bв \d{1,2}[:.]\d{2}\b", re.IGNORECASE),        # время суток
)
# Маркеры ЧИСТОГО расписания: если есть они — это typed-класс, не punt-ловушка
BOUNDARY_EXCLUDE_RES = (
    re.compile(r"каждый (?:понедельник|вторник|среду|четверг|пятницу|"
               r"субботу|воскресенье)\b(?! и )", re.IGNORECASE),
    re.compile(r"по (?:понедельникам|вторникам|средам|четвергам|пятницам|"
               r"субботам|воскресеньям)\b(?! и )", re.IGNORECASE),
    DAILY_WORD,
    HOUR_WORD,
    re.compile(r"(?:каждые|раз в) \d+ час", re.IGNORECASE),
    re.compile(r"раз в час\b", re.IGNORECASE),
)
# Время суток («в 20:00») — конвенция eval: остаётся в text и у typed-классов
TIME_MARK = re.compile(r"\bв \d{1,2}[:.]\d{2}\b", re.IGNORECASE)


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
        # boundary-входы (abs-дата/дедлайн/время/выходные/два дня) — только
        # дословный text (конвенция eval); positives идут через validate_boundary_none
        if any(r.search(input_str) for r in BOUNDARY_RES):
            return False, "none: boundary-вход в обычном батче (нужен дословный text)"
    if rec is not None:
        # конвенция eval (e08): время суток остаётся в text у typed-классов
        m_time = TIME_MARK.search(input_str)
        if m_time and m_time.group(0) not in text:
            return False, f"{rec}: время суток ({m_time.group(0)}) должно остаться в text"
    return True, ""


def validate_boundary_none(cand: dict, input_str: str) -> tuple[bool, str]:
    """(ok, причина) для punt-ловушки (v9): recurring=None, text = вход дословно."""
    if not isinstance(cand, dict):
        return False, "gold не объект"
    text = cand.get("text")
    if not isinstance(text, str) or not (2 <= len(text) <= 110):
        return False, "text пустой/длинный"
    if norm_text(text) != norm_text(input_str):
        return False, "boundary: text != input дословно"
    if (cand.get("recurring") is not None or cand.get("day_of_week") is not None
            or cand.get("interval_hours") is not None):
        return False, "boundary: лишние поля"
    if not any(r.search(input_str) for r in BOUNDARY_RES):
        return False, "boundary: нет семейства ловушки"
    if any(r.search(input_str) for r in BOUNDARY_EXCLUDE_RES):
        return False, "boundary: маркер чистого расписания"
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
- сохраняй исходную форму: вид глагола не менять («сдавать» остаётся «сдавать», не «сдать»), существительные не перефразировать;
- "recurring": null|"daily"|"weekly"|"hourly";
- "day_of_week": null или 0-6 (0=воскресенье, 1=понедельник, …, 6=суббота), только для weekly;
- "interval_hours": null или целое >= 1, только для hourly.

Классы в батче: 2 input с recurring=null, 2 daily, 2 weekly (разные дни), 2 hourly (разные интервалы).
Формат ответа: [{{"input": "...", "gold": {{"text": "...", "recurring": "...", "day_of_week": null, "interval_hours": null}}}}, …]"""


def gen_boundary_prompt(batch_no: int, k: int) -> str:
    cats = "；".join(LLM_CATEGORIES)
    return f"""Батч {batch_no}. Придумай {k} РАЗНЫХ входов на русском для бота-планировщика. Каждый вход — ЛОВУШКА: звучит как расписание, но схемой НЕ выражается (ни один день недели, ни интервал в часах) — значит повторения нет.

Семейства ловушек (используй РАЗНЫЕ, не повторяйся):
- два дня недели: «каждый вторник и четверг …», «… по понедельникам и средам»;
- выходные: «по выходным …», «… на выходных»;
- минуты: «… каждые 30 минут», «раз в 45 минут …»;
- интервал в днях: «… раз в 3 дня»;
- абсолютная дата/дедлайн: «завтра …», «послезавтра …», «… до пятницы», «в понедельник …»;
- время суток без периода: «… в 20:00».

Требования к input: живые формулировки, как человек пишет в чате; темы по кругу: {cats};
НЕ используй действия из списка: {", ".join(EVAL_ACTIONS)};
НЕ используй «каждый день», «ежедневно», «каждый час», «каждые N часов» и один день недели — это чистые расписания, а не ловушки.

gold: "text" — ДОСЛОВНО тот же текст, что input (первая буква заглавная),
"recurring": null, "day_of_week": null, "interval_hours": null.

Формат ответа: [{{"input": "...", "gold": {{"text": "...", "recurring": null, "day_of_week": null, "interval_hours": null}}}}, …]"""


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
                        rng: random.Random, *,
                        prompt_fn=gen_prompt,
                        validator=validate_candidate,
                        tag: str = "llm") -> tuple[list[dict], list[dict], dict]:
    """Возвращает (принятые, отклонённые, статистика)."""
    accepted: list[dict] = []
    rejected: list[dict] = []
    seen_inputs: set[str] = set()
    stats = {"batches": 0, "parse_fail": 0, "candidates": 0, "accepted": 0,
             "rejected_rules": 0, "rejected_dup": 0}
    for b in range(1, batches + 1):
        try:
            raw = ollama_chat(model, GEN_SYSTEM, prompt_fn(b, per_batch))
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
            ok, why = validator(item["gold"], input_str)
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
                             "source": tag})
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


def merge_pool_from_messages(path: Path, tag: str) -> tuple[list[dict], int]:
    """Обратный to_messages: train.jsonl -> pool-элементы (для --keep-valid v9).

    Строки, конфликтующие с конвенцией eval (boundary-вход без дословного
    text; typed без «в HH:MM» в text), отбрасываются — счётчик в stats.
    """
    pool: list[dict] = []
    dropped = 0
    if not path.exists():
        return pool, dropped
    with open(path, encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            msgs = json.loads(line)["messages"]
            user = msgs[1]["content"]
            g = json.loads(msgs[2]["content"])
            if g["recurring"] is None:
                if (any(r.search(user) for r in BOUNDARY_RES)
                        and norm_text(g["text"]) != norm_text(user)):
                    dropped += 1
                    continue
            else:
                m_time = TIME_MARK.search(user)
                if m_time and m_time.group(0) not in g["text"]:
                    dropped += 1
                    continue
            pool.append({"input": user, "gold": g, "source": tag})
    return pool, dropped


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--llm-model", default="qwen2.5:7b-instruct")
    ap.add_argument("--llm-batches", type=int, default=30)
    ap.add_argument("--boundary-batches", type=int, default=0,
                    help="батчи punt-ловушек (v9): вход с маркерами, gold=null, text дословно")
    ap.add_argument("--per-batch", type=int, default=8)
    ap.add_argument("--no-llm", action="store_true")
    ap.add_argument("--keep-valid", action="store_true",
                    help="не перезаписывать data/valid.jsonl; старый train мержится в пул, "
                         "новый train фильтруется от почти-дублей к старому valid")
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

    # 1b. Старый train v8 — подмешиваем, чтобы LLM-входы прогона v8 не терялись
    merged_v8 = 0
    merged_v8_dropped = 0
    keep_valid_rows: list[dict] = []
    if args.keep_valid:
        old_train, merged_v8_dropped = merge_pool_from_messages(
            DATA / "train.jsonl", "v8-train")
        merged_v8 = len(old_train)
        pool.extend(old_train)
        if (DATA / "valid.jsonl").exists():
            with open(DATA / "valid.jsonl", encoding="utf-8") as f:
                keep_valid_rows = [json.loads(l) for l in f if l.strip()]

    # 2. LLM-входы (реальный локальный прогон)
    llm_stats: dict = {"skipped": True}
    if not args.no_llm:
        t0 = time.time()
        acc, rej, llm_stats = generate_llm_inputs(
            args.llm_model, args.llm_batches, args.per_batch, rng)
        rejected_all: list[dict] = list(rej)
        pool.extend(acc)
        boundary_stats: dict = {"skipped": True}
        if args.boundary_batches:
            acc_b, rej_b, boundary_stats = generate_llm_inputs(
                args.llm_model, args.boundary_batches, args.per_batch, rng,
                prompt_fn=gen_boundary_prompt,
                validator=validate_boundary_none,
                tag="llm-boundary")
            rejected_all.extend(rej_b)
            pool.extend(acc_b)
        llm_stats["boundary"] = boundary_stats
        llm_stats["wall_sec"] = round(time.time() - t0, 1)
        with open(DATA / "rejected.jsonl", "w", encoding="utf-8") as f:
            for r in rejected_all:
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

    # 3b. keep-valid: старый valid не трогаем — новый train чистим от его дублей
    valid_kept = 0
    valid_overlap_dropped = 0
    if args.keep_valid and keep_valid_rows:
        valid_norms = [norm_text(r["messages"][1]["content"]) for r in keep_valid_rows]
        clean, valid_overlap_dropped = drop_eval_leak(clean, valid_norms)
        valid_kept = len(keep_valid_rows)

    # 4. Разброс классов (баланс)
    by_class: dict[str, int] = {str(k): 0 for k in RECURRING}
    for item in clean:
        by_class[str(item["gold"]["recurring"])] += 1
    by_source: dict[str, int] = {}
    for item in clean:
        src = str(item.get("source", "?"))
        by_source[src] = by_source.get(src, 0) + 1

    # 5. Сплит (keep-valid: valid старый, весь новый пул — в train)
    if args.keep_valid and keep_valid_rows:
        rng.shuffle(clean)
        train, valid = clean, keep_valid_rows
    else:
        rng.shuffle(clean)
        n_valid = max(30, int(len(clean) * 0.12))
        valid, train = clean[:n_valid], clean[n_valid:]

    DATA.mkdir(exist_ok=True)
    with open(DATA / "train.jsonl", "w", encoding="utf-8") as f:
        for item in train:
            f.write(json.dumps(to_messages(item), ensure_ascii=False) + "\n")
    if not (args.keep_valid and keep_valid_rows):
        with open(DATA / "valid.jsonl", "w", encoding="utf-8") as f:
            for item in valid:
                f.write(json.dumps(to_messages(item), ensure_ascii=False) + "\n")

    stats = {
        "seeds_total": seeds_total,
        "merged_v8_train": merged_v8,
        "merged_v8_dropped_convention": merged_v8_dropped,
        "keep_valid": bool(args.keep_valid and keep_valid_rows),
        "valid_kept": valid_kept,
        "train_valid_overlap_dropped": valid_overlap_dropped,
        "llm": llm_stats,
        "pool_total": len(pool),
        "exact_dup_dropped": exact_dup,
        "near_dup_dropped": near_dropped,
        "eval_leak_dropped": leak_dropped,
        "final_total": len(clean),
        "train": len(train),
        "valid": len(valid),
        "by_class_total": by_class,
        "by_source": by_source,
        "near_dup_threshold": 0.92,
        "seed": args.seed,
    }
    with open(DATA / "stats.json", "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)
    print(json.dumps(stats, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
