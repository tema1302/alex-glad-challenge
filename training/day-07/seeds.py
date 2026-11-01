# Сиды дня-07: константы задачи NL -> JSON add_todo и шаблоны с gold по построению.
# Правила:
#   - text = чистая формулировка действия (без слов о расписании: "каждый",
#     "напоминай", "раз в" и т.п.), первая буква заглавная;
#   - day_of_week: 0=вс ... 6=сб (конвенция JS getDay, как в todoParser.ts);
#   - interval_hours: int >= 1 (часы; минуты вне схемы — boundary-punt);
#   - scheduled_at вне схемы (недетерминированный gold), такие фразы -> punt.

import json
from typing import Callable

# Короткий системный промпт: один и тот же в обучении и в режиме tuned.
SYSTEM_PROMPT = (
    'Ты конвертируешь текст задачи в JSON для планировщика. '
    'Поля: "text" (строгое действие без слов о расписании), '
    '"recurring" (null|"daily"|"weekly"|"hourly"), '
    '"day_of_week" (null или 0-6, где 0=воскресенье), '
    '"interval_hours" (null или целое >= 1). '
    'Ответ: только компактный JSON, без пояснений.'
)

# --- Формы дней недели (для шаблонов) -------------------------------
# dow JS: 0=вс, 1=пн, ... 6=сб. Формы: именительный + винительный.
DAY_FORMS = {
    0: ("воскресенье", "воскресенье"),   # ср.р -> каждое
    1: ("понедельник", "понедельник"),   # м.р -> каждый
    2: ("вторник", "вторник"),
    3: ("среда", "среду"),               # ж.р -> каждую
    4: ("четверг", "четверг"),
    5: ("пятница", "пятницу"),
    6: ("суббота", "субботу"),
}
DOW_WORD = {
    "понедельник": 1, "вторник": 2, "среду": 3, "среда": 3,
    "четверг": 4, "пятницу": 5, "пятница": 5, "субботу": 6,
    "суббота": 6, "воскресенье": 0,
}
# Род дня для «каждый/каждую/каждое»
DAY_GENDER = {0: "каждое", 1: "каждый", 2: "каждый", 3: "каждую",
              4: "каждый", 5: "каждую", 6: "каждую"}

# Склонение «час»: 1 -> час, 2-4 -> часа, 5+ -> часов
def hour_word(n: int) -> str:
    if n % 10 == 1 and n % 100 != 11:
        return "час"
    if n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14):
        return "часа"
    return "часов"

# --- Действия --------------------------------------------------------
# Списки train и eval НЕ пересекаются (проверяется assert-ом ниже).
TRAIN_ACTIONS = [
    "полить цветы", "вымести мусор", "протереть пыль", "погладить рубашки",
    "сделать зарядку", "выпить витамины", "погулять с собакой",
    "написать пост в блог", "разобрать входящие письма", "сделать бэкап репозитория",
    "проверить метрики сервера", "обновить зависимости проекта",
    "полить рассаду", "подкормить кота", "поменять воду в аквариуме",
    "прочитать главу книги", "разминка для спины", "проверить календарь на неделю",
    "написать отчёт о неделе", "проверить комментарии в блоге",
    "посмотреть статистику канала", "собрать рюкзак", "записать расходы",
    "повторить слова английского", "прозвонить клиентов",
    "почистить почтовый ящик", "сделать коммит в проект", "проверить бэкапы",
]
EVAL_ACTIONS = [
    "помыть окна", "вынести коробки", "зарядить ноутбук", "заказать продукты",
    "позвонить маме", "обновить резюме", "проверить домен", "пересадить фикус",
    "смазать велосипед", "посчитать доходы", "выбрать подарок", "сдать анализы",
]
assert not (set(TRAIN_ACTIONS) & set(EVAL_ACTIONS)), "train/eval actions пересекаются"

# Полезные «вежливые» префиксы (не попадают в text)
PREFIXES = ["", "не забудь ", "нужно ", "пора ", "надо "]
# Префиксы-намерения (тоже не в text; "напомни/напоминай" = маркер задачи)
REMIND_PREFIXES = ["напомни ", "напоминай про ", "напоминай "]


def cap(s: str) -> str:
    return s[0].upper() + s[1:] if s else s


def gold(text: str, recurring: str | None = None,
         day_of_week: int | None = None,
         interval_hours: int | None = None) -> dict:
    return {
        "text": cap(text),
        "recurring": recurring,
        "day_of_week": day_of_week,
        "interval_hours": interval_hours,
    }


def compact(obj: dict) -> str:
    """Канонический формат ответа — компактный JSON в одну строку."""
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


# --- Шаблоны сидов ---------------------------------------------------
# Каждый шаблон: функция(slot) -> (input_text, gold_dict, tag).
# slot - кортеж значений; экспансия выполняет generate_data.py.

SeedFn = Callable[..., tuple[str, dict, str]]


def seed_weekly_kazhdyy(action: str, dow: int) -> tuple[str, dict, str]:
    d = DAY_FORMS[dow][1]
    return (f"напоминай {action} каждый {d}" if DAY_GENDER[dow] == "каждый"
            else f"напоминай {action} каждую {d}"), \
        gold(action, "weekly", dow), "seed-weekly"


def seed_weekly_colon(action: str, dow: int) -> tuple[str, dict, str]:
    d = DAY_FORMS[dow][0]
    return (f"{DAY_GENDER[dow].capitalize()} {d}: {action}."), \
        gold(action, "weekly", dow), "seed-weekly"


# Дательный мн.ч. («по понедельникам») и родительный («до пятницы»)
DATIVE_PLURAL = {0: "воскресеньям", 1: "понедельникам", 2: "вторникам",
                 3: "средам", 4: "четвергам", 5: "пятницам", 6: "субботам"}
GENITIVE = {0: "воскресенья", 1: "понедельника", 2: "вторника", 3: "среды",
            4: "четверга", 5: "пятницы", 6: "субботы"}


def seed_weekly_po(action: str, dow: int) -> tuple[str, dict, str]:
    return f"{action} по {DATIVE_PLURAL[dow]}", gold(action, "weekly", dow), "seed-weekly"


def seed_daily_prefix(action: str, prefix: str) -> tuple[str, dict, str]:
    return f"{prefix}каждый день {action}", gold(action, "daily"), "seed-daily"


def seed_daily_suffix(action: str) -> tuple[str, dict, str]:
    return f"{action} каждый день", gold(action, "daily"), "seed-daily"


def seed_daily_ezhednevno(action: str) -> tuple[str, dict, str]:
    return f"ежедневно {action}", gold(action, "daily"), "seed-daily"


def seed_hourly_kazhdye(action: str, n: int) -> tuple[str, dict, str]:
    return (f"{action} каждые {n} {hour_word(n)}",
            gold(action, "hourly", None, n), "seed-hourly")


def seed_hourly_raz(action: str, n: int) -> tuple[str, dict, str]:
    return (f"раз в {n} {hour_word(n)}: {action}",
            gold(action, "hourly", None, n), "seed-hourly")


def seed_hourly_each(action: str) -> tuple[str, dict, str]:
    return f"каждый час {action}", gold(action, "hourly", None, 1), "seed-hourly"


def seed_none_bare(action: str, prefix: str) -> tuple[str, dict, str]:
    return f"{prefix}{action}", gold(action), "seed-none"


def seed_none_remind(action: str) -> tuple[str, dict, str]:
    return f"{REMIND_PREFIXES[0]}{action}", gold(action), "seed-none"


# --- Boundary-пунты и время суток (v9, issue #179) ---------------------
# Пунт-границы из README дня: два дня, «по выходным», минуты, интервалы в
# днях, абсолютные даты/дедлайны, время суток без периода. Gold: recurring=
# None, text = вход ДОСЛОВНО (в отличие от обычных сидов, где text очищен).
# Для daily/weekly с временем суток: «в 20:00» ОСТАЁТСЯ в text.

def seed_punt_verbatim(input_text: str) -> tuple[str, dict, str]:
    return input_text, gold(input_text), "seed-punt-boundary"


def seed_daily_time(action: str, t: str) -> tuple[str, dict, str]:
    return f"каждый день {action} в {t}", \
        gold(f"{action} в {t}", "daily"), "seed-daily-time"


def seed_weekly_time(action: str, dow: int, t: str) -> tuple[str, dict, str]:
    d = DAY_FORMS[dow][1]
    g = DAY_GENDER[dow]
    return f"{g} {d} {action} в {t}", \
        gold(f"{action} в {t}", "weekly", dow), "seed-weekly-time"


# Экспортируемые сиды: (callable, слоты) — раскрываются в generate_data.py
SEED_CALLS: list[tuple[SeedFn, tuple]] = []
for a in TRAIN_ACTIONS:
    SEED_CALLS.append((seed_daily_prefix, (a, PREFIXES[1])))
    SEED_CALLS.append((seed_daily_suffix, (a,)))
    SEED_CALLS.append((seed_daily_ezhednevno, (a,)))
    SEED_CALLS.append((seed_hourly_each, (a,)))
    SEED_CALLS.append((seed_none_bare, (a, PREFIXES[0])))
    SEED_CALLS.append((seed_none_bare, (a, PREFIXES[3])))
    SEED_CALLS.append((seed_none_remind, (a,)))
for a in TRAIN_ACTIONS[:16]:
    for d in (1, 3, 6):
        SEED_CALLS.append((seed_weekly_kazhdyy, (a, d)))
        SEED_CALLS.append((seed_weekly_po, (a, d)))
for a in TRAIN_ACTIONS[:12]:
    for d in (2, 5, 0):
        SEED_CALLS.append((seed_weekly_colon, (a, d)))
for a in TRAIN_ACTIONS[:14]:
    for n in (2, 4, 8):
        SEED_CALLS.append((seed_hourly_kazhdye, (a, n)))
        SEED_CALLS.append((seed_hourly_raz, (a, n)))

# Boundary-пунты (v9): recurring=None, text дословно — закрывают skew,
# при котором в train punt-входы без маркеров, а в eval 11/30 — с маркерами.
# Объём подобран под баланс ~35-40% None в итоговом train (eval: 37% None).
_PUNT_ACTIONS = TRAIN_ACTIONS[12:28]        # 16 действий, не задействованных выше
_PUNT_ACTIONS_SHORT = TRAIN_ACTIONS[12:20]  # 8 действий для объёмных семейств
_TWO_DAY_PAIRS = ((1, 4), (2, 5), (3, 6))
_MINUTES = (30, 45)
_DAY_INTERVALS = (2, 3)
_ABS_RELATIVE = ("завтра", "послезавтра", "сегодня вечером")
_DEADLINE_DAYS = (5, 3, 1)
_ACC_DAYS = (1, 4, 6)
_TIMES = ("9:00", "15:00", "20:00")

for a in _PUNT_ACTIONS_SHORT:                        # два дня недели
    for d1, d2 in _TWO_DAY_PAIRS:
        day1, day2 = DAY_FORMS[d1][0], DAY_FORMS[d2][0]
        SEED_CALLS.append((seed_punt_verbatim,
                           (f"{DAY_GENDER[d1]} {day1} и {day2} {a}",)))
for a in _PUNT_ACTIONS:                              # выходные
    SEED_CALLS.append((seed_punt_verbatim, (f"по выходным {a}",)))
    SEED_CALLS.append((seed_punt_verbatim, (f"{a} по выходным",)))
for a in _PUNT_ACTIONS_SHORT:                        # минуты (вне схемы часов)
    for m in _MINUTES:
        SEED_CALLS.append((seed_punt_verbatim, (f"{a} каждые {m} минут",)))
        SEED_CALLS.append((seed_punt_verbatim, (f"{a} раз в {m} минут",)))
for a in TRAIN_ACTIONS[12:18]:                       # интервалы в днях
    for n in _DAY_INTERVALS:
        SEED_CALLS.append((seed_punt_verbatim, (f"{a} раз в {n} дня",)))
        SEED_CALLS.append((seed_punt_verbatim, (f"раз в {n} дня {a}",)))
for a in TRAIN_ACTIONS[12:18]:                       # относительные даты
    for w in _ABS_RELATIVE:
        SEED_CALLS.append((seed_punt_verbatim, (f"{w} {a}",)))
for a in TRAIN_ACTIONS[12:18]:                       # дедлайн «до дня»
    for d in _DEADLINE_DAYS:
        SEED_CALLS.append((seed_punt_verbatim, (f"{a} до {GENITIVE[d]}",)))
for a in TRAIN_ACTIONS[12:18]:                       # «в день» без периода
    for d in _ACC_DAYS:
        SEED_CALLS.append((seed_punt_verbatim, (f"в {DAY_FORMS[d][1]} {a}",)))
for a in _PUNT_ACTIONS_SHORT:                        # время суток без периода
    for t in _TIMES:
        SEED_CALLS.append((seed_punt_verbatim, (f"{a} в {t}",)))
for a in TRAIN_ACTIONS[:10]:                         # daily + время суток
    for t in ("20:00", "9:00"):
        SEED_CALLS.append((seed_daily_time, (a, t)))
for a in TRAIN_ACTIONS[:8]:                          # weekly + время суток
    for d in (1, 3, 5):
        SEED_CALLS.append((seed_weekly_time, (a, d, "20:00")))


if __name__ == "__main__":
    seen = set()
    for fn, slots in SEED_CALLS:
        inp, g, _tag = fn(*slots)
        key = inp.strip().lower()
        assert key not in seen, f"дубль сида: {inp}"
        seen.add(key)
    print(f"seed calls: {len(SEED_CALLS)}, unique inputs: {len(seen)}")
    print("пример:", seen and "")
    inp, g, tag = SEED_CALLS[0][0](*SEED_CALLS[0][1])
    print(tag, "|", inp, "->", compact(g))
