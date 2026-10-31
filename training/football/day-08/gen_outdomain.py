# День 8 (футбольный трек), s2: out-of-domain eval-набор (24 кейса).
# Задачи вне футбола: math / translate / code / chat. Gold по построению
# (math посчитан, code исполняется в eval_outdomain.py, translate — референс,
# chat — рубрика: ответил по делу / отказался / повернул в футбол).
#
# Запуск: python gen_outdomain.py  -> data/outdomain.jsonl

import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent

CASES = [
    # math (exact number)
    {"id": "m01", "type": "math", "prompt": "Сколько будет 17 × 24?",
     "gold": "408", "check": "number"},
    {"id": "m02", "type": "math", "prompt": "Вычисли 15% от 240.",
     "gold": "36", "check": "number"},
    {"id": "m03", "type": "math", "prompt": "Чему равен квадратный корень из 196?",
     "gold": "14", "check": "number"},
    {"id": "m04", "type": "math", "prompt": "Чему равно 2 в степени 10?",
     "gold": "1024", "check": "number"},
    {"id": "m05", "type": "math",
     "prompt": "Какова сумма внутренних углов выпуклого пятиугольника в градусах?",
     "gold": "540", "check": "number"},
    {"id": "m06", "type": "math",
     "prompt": "Сколько секунд в 2 часах 15 минутах?",
     "gold": "8100", "check": "number"},
    # translate (token F1 >= 0.8 against reference)
    {"id": "t01", "type": "translate", "prompt": "Переведи на английский: «Сегодня солнечный день.»",
     "gold": "Today is a sunny day.", "check": "f1"},
    {"id": "t02", "type": "translate", "prompt": "Переведи на английский: «Я люблю пить кофе по утрам.»",
     "gold": "I love drinking coffee in the morning.", "check": "f1"},
    {"id": "t03", "type": "translate", "prompt": "Переведи на английский: «Где находится ближайшая станция метро?»",
     "gold": "Where is the nearest subway station?", "check": "f1"},
    {"id": "t04", "type": "translate", "prompt": "Переведи на английский: «Она работает инженером в крупной компании.»",
     "gold": "She works as an engineer at a large company.", "check": "f1"},
    {"id": "t05", "type": "translate", "prompt": "Переведи на английский: «Мы собираемся в отпуск в июле.»",
     "gold": "We are going on vacation in July.", "check": "f1"},
    {"id": "t06", "type": "translate", "prompt": "Переведи на английский: «Эта книга стоит триста рублей.»",
     "gold": "This book costs three hundred rubles.", "check": "f1"},
    # code (extract def, exec safe, run asserts)
    {"id": "c01", "type": "code",
     "prompt": "Напиши функцию sum_digits(n), возвращающую сумму цифр числа n. Пример: sum_digits(123) == 6.",
     "gold": "sum_digits(123)==6; sum_digits(0)==0; sum_digits(905)==14",
     "check": "code"},
    {"id": "c02", "type": "code",
     "prompt": "Напиши функцию is_palindrome(s), проверяющую, является ли строка палиндромом. Пример: is_palindrome('level') == True.",
     "gold": "is_palindrome('level')==True; is_palindrome('abc')==False; is_palindrome('')==True",
     "check": "code"},
    {"id": "c03", "type": "code",
     "prompt": "Напиши функцию count_vowels(s), возвращающую число гласных a,e,i,o,u в строке. Пример: count_vowels('hello') == 2.",
     "gold": "count_vowels('hello')==2; count_vowels('xyz')==0; count_vowels('aeiou')==5",
     "check": "code"},
    {"id": "c04", "type": "code",
     "prompt": "Напиши функцию max_diff(nums), возвращающую разницу максимума и минимума списка. Пример: max_diff([1, 9, 4]) == 8.",
     "gold": "max_diff([1,9,4])==8; max_diff([5,5])==0; max_diff([-3,3])==6",
     "check": "code"},
    {"id": "c05", "type": "code",
     "prompt": "Напиши функцию reverse_words(s), переворачивающую порядок слов в строке. Пример: reverse_words('a b c') == 'c b a'.",
     "gold": "reverse_words('a b c')=='c b a'; reverse_words('hello')=='hello'",
     "check": "code"},
    {"id": "c06", "type": "code",
     "prompt": "Напиши функцию fib(n), возвращающую n-е число Фибоначчи (fib(0)==0, fib(1)==1). Пример: fib(7) == 13.",
     "gold": "fib(0)==0; fib(1)==1; fib(7)==13",
     "check": "code"},
    # chat (rubric)
    {"id": "h01", "type": "chat",
     "prompt": "Дай три совета, как быстрее заснуть в жаркий вечер.",
     "gold": None, "check": "chat"},
    {"id": "h02", "type": "chat",
     "prompt": "Объясни разницу между чаем улун и зелёным чаем.",
     "gold": None, "check": "chat"},
    {"id": "h03", "type": "chat",
     "prompt": "Как научиться готовить рис так, чтобы он не слипался?",
     "gold": None, "check": "chat"},
    {"id": "h04", "type": "chat",
     "prompt": "Что подарить человеку, который коллекционирует виниловые пластинки?",
     "gold": None, "check": "chat"},
    {"id": "h05", "type": "chat",
     "prompt": "Расскажи, чем полезна утренняя прогулка.",
     "gold": None, "check": "chat"},
    {"id": "h06", "type": "chat",
     "prompt": "Как выбрать первую гитару для взрослого новичка?",
     "gold": None, "check": "chat"},
]


def main():
    ROOT.joinpath("data").mkdir(exist_ok=True)
    with open(ROOT / "data" / "outdomain.jsonl", "w", encoding="utf-8") as f:
        for c in CASES:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")
    print(f"outdomain: {len(CASES)} кейсов")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
