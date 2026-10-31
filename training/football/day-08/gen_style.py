# День 8 (футбольный трек), s4: стиль-тон (12 футбольных кейсов).
# Промт «перепиши/напиши в стиле X» с проверяемыми ограничениями
# (rule-скорер, без LLM-судьи): обязательные подстроки, запрещённые символы,
# лимиты длины. Проверяет, переносится ли стиль на футбольный домен и даёт
# ли тюн на JSON что-то для стиля (ожидание: нет).
#
# Запуск: python gen_style.py && python eval_style.py \
#           --adapter ../../day-07/artifacts/adapter \
#           --out ../../../docs/advanced-day-08/football/eval/style

import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent

# правила: all — все подстроки должны быть; none — запрещённые; len — [min,max]
CASES = [
    {"id": "s01", "style": "романо",
     "prompt": "Напиши одним коротким сообщением твит Фабрицио Романо о том, что полузащитник перешёл в «Челси». Не забудь его фирменную фразу.",
     "rules": {"all": ["Here we go"], "max_chars": 280}},
    {"id": "s02", "style": "романо-день",
     "prompt": "Напиши твит Фабрицио Романо о согласовании личного контракта нападающим с «Челси».",
     "rules": {"all": ["Here we go", "Chelsea"], "max_chars": 280}},
    {"id": "s03", "style": "bbc",
     "prompt": "Перепиши итог матча «Челси» — «Арсенал» 2:1 сухим стилем новостной ленты BBC: одно предложение, без эмоций.",
     "rules": {"none": ["!"], "max_chars": 140, "all": ["2-1"]}},
    {"id": "s04", "style": "комментатор-ру",
     "prompt": "Опиши гол Коула Палмера на 89-й минуте, спасший «Челси» от поражения, в стиле русского телекомментатора.",
     "rules": {"all": ["Палмер"], "min_exclaim": 1, "max_chars": 300}},
    {"id": "s05", "style": "тг-пост",
     "prompt": "Напиши пост телеграм-канала о разгроме «Арсенала» со счётом 0:4 в гостях.",
     "rules": {"all": ["0:4"], "max_chars": 220}},
    {"id": "s06", "style": "прессуха",
     "prompt": "Напиши цитату тренера «Челси» после домашнего поражения 0:2: сдержанно, без восклицаний, с упоминанием ответственности.",
     "rules": {"none": ["!"], "all": ["ответственность"], "max_chars": 260}},
    {"id": "s07", "style": "без-слов",
     "prompt": "Напиши анонс матча «Челси» — «Ливерпуль», не используя слов «битва» и «принципиальный».",
     "rules": {"none": ["битва", "принципиальный"], "all": ["Челси", "Ливерпуль"]}},
    {"id": "s08", "style": "твит-болельщик",
     "prompt": "Напиши твит болельщика «Челси» после выигрыша 3:2 — не больше 120 символов, с хэштегом #CFC.",
     "rules": {"all": ["#CFC"], "max_chars": 120}},
    {"id": "s09", "style": "заголовок",
     "prompt": "Придумай газетный заголовок о ничьей «Тоттенхэма» и «Арсенала» 2:2 — не более 10 слов, без восклицательного знака.",
     "rules": {"none": ["!"], "max_words": 10}},
    {"id": "s10", "style": "радио-60",
     "prompt": "Опиши победу «Челси» 1:0 голом на последних минутах для спортивной радиопередачи — до 60 слов, с упоминанием автора гола Мудрика.",
     "rules": {"all": ["Мудрик"], "max_words": 60}},
    {"id": "s11", "style": "прогноз",
     "prompt": "Напиши короткий прогноз на матч АПЛ «Ньюкасл» — «Челси» одним предложением, обязательно со словом «прогноз».",
     "rules": {"all": ["прогноз"], "max_chars": 180}},
    {"id": "s12", "style": "официальный-сайт",
     "prompt": "Напиши официальное сообщение клуба о продлении контракта с вратарём на три года — сдержанно, без восклицаний, со словом «контракт».",
     "rules": {"none": ["!"], "all": ["контракт"]}},
]


def rules_score(rules, text):
    ok = True
    for sub in rules.get("all", []):
        ok = ok and sub.lower() in text.lower()
    for sub in rules.get("none", []):
        ok = ok and sub.lower() not in text.lower()
    if "max_chars" in rules:
        ok = ok and len(text) <= rules["max_chars"]
    if "min_exclaim" in rules:
        ok = ok and text.count("!") >= rules["min_exclaim"]
    if "max_words" in rules:
        ok = ok and len(text.split()) <= rules["max_words"]
    return ok


def main():
    ROOT.joinpath("eval").mkdir(exist_ok=True)
    with open(ROOT / "eval" / "style.jsonl", "w", encoding="utf-8") as f:
        for c in CASES:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")
    print(f"style: {len(CASES)} кейсов")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
