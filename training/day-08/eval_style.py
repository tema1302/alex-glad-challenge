# День-08 s4 (#167): стиль-тон — третий тип задач. 12 кейсов «перепиши в
# стиле X» с rule-скорером ограничений (проверяемо без LLM-судьи):
#   no_exclaim — нет '!' в ответе; ban_words — нет слов из списка;
#   max_words / min_words — границы длины; must_words — обязательные слова.
# score = доля выполненных ограничений.
#
# Бэкенды: --backend ollama (локально, base-only) | transformers
# (Kaggle T4, tuned vs base через adapter day-07).
# Запуск: python eval_style.py --backend ollama --model qwen2.5:1.5b-instruct \
#   --modes base-none,base-prompt --out ../../docs/advanced-day-08/eval/style-1.5b

import argparse
import json
import re
import statistics
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from eval_facts import normalize, safe_model_name

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "eval" / "eval_style.jsonl"

GENERIC_SYSTEM = ("Ты редактор текстов. Переписывай текст в заданном стиле. "
                  "Соблюдай все ограничения стиля буквально: не используй "
                  "запрещённые слова, восклицательные знаки; соблюдай лимит "
                  "длины. Вывод только переписанный текст.")

STYLE_SYSTEM = ("Ты редактор текстов. Переписывай текст строго в заданном "
                "стиле: без восклицательных знаков, без разговорных слов, "
                "соблюдай лимит длины. Вывод — только переписанный текст, "
                "без пояснений.")


def load_cases() -> list[dict]:
    if not OUT.exists():
        raise SystemExit(f"нет {OUT} — запусти gen_style.py")
    with open(OUT, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def check(constraint: dict, text: str) -> bool:
    kind = constraint["kind"]
    words = normalize(text).split()
    if kind == "no_exclaim":
        return "!" not in text and "!" not in text.replace("¡", "")
    if kind == "ban_words":
        hay = " " + normalize(text) + " "
        return not any(re.search(r"\b" + re.escape(normalize(w)) + r"\b", hay)
                       for w in constraint["words"])
    if kind == "max_words":
        return len(words) <= constraint["n"]
    if kind == "min_words":
        return len(words) >= constraint["n"]
    if kind == "must_words":
        hay = " " + normalize(text) + " "
        return any(re.search(r"\b" + re.escape(normalize(w)) + r"\b", hay)
                   for w in constraint["words"])
    raise ValueError(f"неизвестное ограничение: {kind}")


def score_case(case: dict, text: str) -> float:
    hits = sum(int(check(c, text)) for c in case["constraints"])
    return round(hits / len(case["constraints"]), 4)


def build_messages(mode: str, case: dict) -> list[dict]:
    if mode == "base-prompt":
        return [{"role": "system", "content": STYLE_SYSTEM},
                {"role": "user", "content": case["input"]}]
    return [{"role": "user", "content": case["input"]}]


def ollama_chat(model: str, messages: list[dict], seed: int = 42,
                timeout: int = 180) -> str:
    body = json.dumps({
        "model": model, "messages": messages, "stream": False,
        "options": {"temperature": 0, "seed": seed, "num_predict": 128},
    }).encode("utf-8")
    req = urllib.request.Request(
        "http://localhost:11434/api/chat", data=body,
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))["message"]["content"]


def run_ollama(args, cases: list[dict]) -> dict[str, list[dict]]:
    rows_by_mode: dict[str, list[dict]] = {}
    for mode in [m.strip() for m in args.modes.split(",") if m.strip()]:
        rows = []
        for case in cases:
            t0 = time.monotonic()
            raw = ollama_chat(args.model, build_messages(mode, case),
                              seed=args.seed)
            dt = (time.monotonic() - t0) * 1000
            rows.append({"id": case["id"], "mode": mode,
                         "input": case["input"], "raw": raw[:400],
                         "score": score_case(case, raw),
                         "latency_ms": round(dt)})
            print(f"[{mode}] {case['id']} score={rows[-1]['score']}",
                  flush=True)
        rows_by_mode[mode] = rows
    return rows_by_mode


def run_transformers(args, cases: list[dict]) -> dict[str, list[dict]]:
    import torch  # noqa: PLC0415
    import yaml  # noqa: PLC0415
    from transformers import AutoModelForCausalLM, AutoTokenizer  # noqa: PLC0415
    from transformers import BitsAndBytesConfig  # noqa: PLC0415
    from peft import PeftModel  # noqa: PLC0415

    with open(args.config, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    qcfg = cfg["quantization"]
    quant = BitsAndBytesConfig(
        load_in_4bit=qcfg["load_in_4bit"],
        bnb_4bit_quant_type=qcfg["bnb_4bit_quant_type"],
        bnb_4bit_use_double_quant=qcfg["bnb_4bit_use_double_quant"],
        bnb_4bit_compute_dtype=getattr(torch, qcfg["bnb_4bit_compute_dtype"]))
    model = AutoModelForCausalLM.from_pretrained(
        cfg["model"]["base"], quantization_config=quant, device_map="auto",
        attn_implementation=cfg["model"]["attn_implementation"])
    model = PeftModel.from_pretrained(model, args.adapter)
    tok = AutoTokenizer.from_pretrained(args.adapter)
    torch.manual_seed(args.seed)

    rows_by_mode: dict[str, list[dict]] = {}
    for mode in [m.strip() for m in args.modes.split(",") if m.strip()]:
        rows = []
        for case in cases:
            msgs = build_messages(mode, case)
            ids = tok.apply_chat_template(
                msgs, tokenize=True, add_generation_prompt=True,
                return_tensors="pt").to(model.device)
            ctx = model.disable_adapter() if mode.startswith("base-") else None
            t0 = time.perf_counter()
            if ctx is not None:
                with ctx:
                    out = model.generate(ids, max_new_tokens=128,
                                         do_sample=False,
                                         pad_token_id=tok.pad_token_id)
            else:
                out = model.generate(ids, max_new_tokens=128,
                                     do_sample=False,
                                     pad_token_id=tok.pad_token_id)
            text = tok.decode(out[0][ids.shape[1]:], skip_special_tokens=True)
            dt = (time.perf_counter() - t0) * 1000
            rows.append({"id": case["id"], "mode": mode,
                         "input": case["input"], "raw": text[:400],
                         "score": score_case(case, text),
                         "latency_ms": round(dt)})
            print(f"[{mode}] {case['id']} score={rows[-1]['score']}",
                  flush=True)
        rows_by_mode[mode] = rows
    return rows_by_mode


def aggregate(rows: list[dict]) -> dict:
    return {
        "n": len(rows),
        "score_avg": round(statistics.mean(r["score"] for r in rows), 4),
        "latency_avg_ms": round(statistics.mean(r["latency_ms"] for r in rows)),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", choices=["ollama", "transformers"],
                    required=True)
    ap.add_argument("--model", default=None)
    ap.add_argument("--config", default=None)
    ap.add_argument("--adapter", default="artifacts/adapter")
    ap.add_argument("--modes", default=None)
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    if args.backend == "ollama" and not args.model:
        ap.error("--backend ollama требует --model")
    if args.backend == "transformers" and not args.config:
        ap.error("--backend transformers требует --config")
    if args.modes is None:
        args.modes = ("base-none,base-prompt" if args.backend == "ollama"
                      else "tuned,base-none,base-prompt")

    cases = load_cases()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    if args.backend == "ollama":
        rows_by_mode = run_ollama(args, cases)
        label = args.model
    else:
        rows_by_mode = run_transformers(args, cases)
        label = f"transformers+{args.adapter}"

    agg = {m: aggregate(r) for m, r in rows_by_mode.items()}
    for mode, rows in rows_by_mode.items():
        with open(out_dir / f"results_{safe_model_name(mode)}.jsonl", "w",
                  encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
    summary = {"backend": args.backend, "model": label,
               "generated_at": datetime.now(timezone.utc).isoformat(),
               "seed": args.seed, "modes": agg}
    (out_dir / "style.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [f"# Style eval — {label} (day-08 s4)", "",
             f"Сгенерировано: {summary['generated_at']}, seed={args.seed}",
             f"Кейсов: {len(cases)}; score = доля выполненных ограничений.", "",
             "| Режим | score avg | latency, мс |", "|---|---|---|"]
    for mode, a in agg.items():
        lines.append(f"| {mode} | {a['score_avg']:.2f} | "
                     f"{a['latency_avg_ms']} |")
    lines += ["", "Покейсово: `results_<режим>.jsonl`; метрики: `style.json`."]
    (out_dir / "style_report.md").write_text(
        "\n".join(lines) + "\n", encoding="utf-8")
    print(f"OK -> {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
