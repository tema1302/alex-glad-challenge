# День 9 (футбольный трек): дожим отклонённых teacher-сэмплов.
# К первому прогону (gen_teacher.py, accept 60/120) претензии были:
# минуты голов опущены, счёт от лица победителя. Повторный проход с
# усиленным системным промптом; принятые дописываются в distill_train.jsonl.
#
# Запуск: python retry_teacher.py --model qwen2.5:7b-instruct

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from gen_teacher import ask_ollama  # noqa: E402
from report_rules import facts_present, missing_facts  # noqa: E402

ROOT = Path(__file__).resolve().parent

STRICT_SYSTEM = (
    "Ты спортивный журналист. По JSON-описанию футбольного матча напиши "
    "короткий репортаж: один-два предложения, только факты из JSON. "
    "Жёсткие правила: (1) счёт пиши строго в формате «домашний:гостевой» как "
    "в полях home_score и away_score; (2) у КАЖДОГО автора гола в скобках "
    "обязательно укажи минуту: Имя (25'); (3) назови обе команды и турнир. "
    "Без заголовков, без оценок, без информации не из JSON. До 240 символов.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="qwen2.5:7b-instruct")
    ap.add_argument("--base-url", default="http://localhost:11434")
    ap.add_argument("--rejects", default=str(ROOT / "data" / "rejected.jsonl"))
    ap.add_argument("--out", default=str(ROOT / "data" / "distill_train.jsonl"))
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    rejects = [json.loads(l) for l in open(args.rejects, encoding="utf-8")
               if l.strip()]
    accepted, still = [], []
    t0 = time.monotonic()
    for i, row in enumerate(rejects):
        task = row["task"]
        user = "Напиши репортаж по этому JSON:\n" + json.dumps(
            task, ensure_ascii=False)
        raw = ask_ollama(args.base_url, args.model,
                         [{"role": "system", "content": STRICT_SYSTEM},
                          {"role": "user", "content": user}], args.seed)
        ok = facts_present(task, raw)
        (accepted if ok else still).append({"task": task, "report": raw,
                                            "missing": [] if ok else
                                            missing_facts(task, raw)})
        print(f"[{i+1}/{len(rejects)}] {'OK' if ok else 'REJ'}",
              flush=True)

    with open(args.out, "a", encoding="utf-8") as f:
        for row in accepted:
            f.write(json.dumps({
                "messages": [
                    {"role": "system", "content": STRICT_SYSTEM},
                    {"role": "user", "content": "Напиши репортаж по этому JSON:\n"
                        + json.dumps(row["task"], ensure_ascii=False)},
                    {"role": "assistant", "content": row["report"]},
                ]}, ensure_ascii=False) + "\n")
    with open(args.rejects, "w", encoding="utf-8") as f:
        for row in still:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    stats = {"retry_total": len(rejects), "retry_accepted": len(accepted),
             "still_rejected": len(still),
             "wall_s": round(time.monotonic() - t0, 1)}
    print(json.dumps(stats, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
