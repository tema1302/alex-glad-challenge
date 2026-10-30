# День-08 s1 (#164): rule-генерация синтетических фактов, которых нет в модели.
# Выдуманные сущности (персоны, книги, приборы, города) со слотом-ответом —
# комбинации случайны (Random(42)), поэтому в pretrain их быть не должно.
#
# Выход: data/facts.jsonl — {"id", "fact", "slot", "answer"}
# Запуск: python gen_facts.py

import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "data" / "facts.jsonl"

FIRST = ["Алдон", "Велемир", "Гордон", "Дарина", "Ефросин", "Зелимхан",
         "Илария", "Климент", "Любомира", "Мстислав", "Никанор", "Олимпиада",
         "Порфирий", "Радомир", "Северин", "Тихомир", "Устинья", "Фортунат",
         "Чеслав", "Элеонора", "Ярополк", "Агния", "Бронислав", "Всеволод"]
LAST = ["Глухарёв", "Жемчужников", "Караулов", "Лютых", "Морозенко",
        "Опарин", "Плутонов", "Ржевский", "Сумароков", "Талалихин",
        "Углич", "Холмогоров", "Цветаев", "Шувалов", "Эфрон", "Ясенев"]
ORG = ["Волжский институт квантовой метеорологии",
       "Бюро гидравлических прогнозов Юга",
       "Лаборатория северного земледелия",
       "Траст развития медленных технологий",
       "Академия прикладной акустики им. Брынцева",
       "Центр изучения редких осадков",
       "Объединённая мастерская точных весов",
       "Институт ночной логистики",
       "Консорциум малых энергосетей"]
PUBLISHER = ["Северное перо", "Гранит-пресс", "Издательство «Медный всадник»",
             "Типография «Тихий берег»", "Дом книги «Ветеран»",
             "Редакция «Жёлтый фонарь»", "Полиграфкомбинат «Пролом»",
             "Издательский дом «Крапива»"]
TITLE_NOUN = ["Справочник", "Хроника", "Учебник", "Атлас", "Дневник", "Трактат"]
TITLE_ADJ = ["скрытых", "безвредных", "поздних", "коротких", "лесных",
             "медленных", "резервных", "тихих"]
TITLE_OBJ = ["осадков", "швов", "перевалов", "запахов", "каналов",
             "приливов", "обрывов", "погребов"]
DEVICE = ["термоскоп ТС-7", "влагомер ВЛ-12", "азимут-3", "крон-метр КМ-2",
          "плотномер ПЛ-5", "сейсмограф СГ-9", "люксметр Л-44", "шумомер Ш-8",
          "градусник ГР-21"]
COMPANY = ["Завод «Красная излучина»", "НПО «Вертикаль»",
           "Фирма «Седьмая печать»", "Завод «Меридиан»",
           "Мануфактура «Точный вес»", "Комбинат «Северный луч»",
           "Цех «Дальний привал»", "Производство «Утренняя смена»"]
CITY = ["Верхние Ключи", "Малый Пролом", "Каменный Брод", "Тихая Заводь",
        "Средние Воды", "Новый Откос", "Дальний Плес", "Красная Гать",
        "Зимний Кордон"]
REGION = ["Белоярский край", "Верхнечусовская область",
          "Прилукский округ", "Таёжный район", "Низовой край",
          "Озёрная губерния", "Степной уезд", "Кордонская область"]
SLOTS = {
    "year": lambda r: str(r.randint(1873, 2023)),
    "name": lambda r: f"{r.choice(FIRST)} {r.choice(LAST)}",
    "watts": lambda r: str(r.randint(5, 999)),
    "pop": lambda r: str(r.randrange(12, 950) * 1000),
}

FACTS_PER_KIND = 9


def draw(r: random.Random, slot: str, used: set[str]) -> str:
    """Значение слота уникально в рамках своего типа — eval чище."""
    for _ in range(200):
        value = SLOTS[slot](r)
        if value not in used:
            used.add(value)
            return value
    raise RuntimeError(f"не удалось выбрать уникальный {slot}")


def build_facts(r: random.Random) -> list[dict]:
    facts: list[dict] = []
    used: dict[str, set[str]] = {s: set() for s in SLOTS}
    for i in range(FACTS_PER_KIND):
        org = r.choice(ORG)
        year = draw(r, "year", used["year"])
        facts.append({
            "fact": f"{draw(r, 'name', used['name'])} — главный инженер организации "
                    f"«{org}», основанной в {year} году.",
            "slot": "year", "answer": year,
        })
        noun, adj, obj = (r.choice(TITLE_NOUN), r.choice(TITLE_ADJ),
                          r.choice(TITLE_OBJ))
        title, name = f"{noun} {adj} {obj}", draw(r, "name", used["name"])
        facts.append({
            "fact": f"Книга «{title}» написана {name}, издана издательством "
                    f"«{r.choice(PUBLISHER)}» в {draw(r, 'year', used['year'])} году.",
            "slot": "name", "answer": name,
        })
        device, watts = r.choice(DEVICE), draw(r, "watts", used["watts"])
        facts.append({
            "fact": f"Прибор «{device}» потребляет {watts} ватт и выпущен "
                    f"компанией «{r.choice(COMPANY)}».",
            "slot": "watts", "answer": watts,
        })
        city, pop = r.choice(CITY), draw(r, "pop", used["pop"])
        facts.append({
            "fact": f"Город {city} насчитывает {pop} жителей и расположен "
                    f"в регионе «{r.choice(REGION)}».",
            "slot": "pop", "answer": pop,
        })
    return facts


def main() -> int:
    r = random.Random(42)
    facts = build_facts(r)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        for i, row in enumerate(facts):
            f.write(json.dumps({"id": f"f{i:02d}", **row},
                               ensure_ascii=False) + "\n")
    print(f"facts: {len(facts)} -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
