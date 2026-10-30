# День-08 s1 (#164): замер «факты в промпте» vs base на Ollama (локально).
# Два режима на одном eval-наборе:
#   none   — вопрос без контекста (фактов нет в модели -> провал ожидаем);
#   prompt — все факты в system (RAG-подобная подстановка -> рост ожидаем).
# Температура 0, seed=42; метрика — exact-match нормализованный + relaxed
# (gold входит в ответ). Отчёт пишется в --out.
#
# Запуск (локально):
#   python eval_facts.py --model qwen2.5:1.5b-instruct \
#     --modes none,prompt --out ../../docs/advanced-day-08/eval
# Запуск tuned vs base (Kaggle T4, adapter day-07):
#   python eval_facts.py --backend transformers \
#     --config /kaggle/working/day07/configs/qlora.yaml \
#     --adapter /kaggle/working/day07/artifacts/adapter \
#     --modes tuned,base-none --out /kaggle/working/facts-tuned
#
# Выход: results_<model>.jsonl (покейсово), facts.json (метрики), facts_report.md.

import argparse
import json
import re
import statistics
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_EVAL = ROOT / "eval" / "eval_facts.jsonl"
DEFAULT_FACTS = ROOT / "data" / "facts.jsonl"

SYSTEM_NONE = "Ты точный помощник. Отвечай коротко."
ANSWER_HINT = " Ответь одним словом или числом."


def load_jsonl(path: Path) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def facts_system(facts: list[dict]) -> str:
    lines = "\n".join(f"- {row['fact']}" for row in facts)
    return ("Ты справочник по вымышленному миру. Запомни факты:\n"
            f"{lines}\nОтвечай на вопросы одним словом или числом, "
            "опираясь только на эти факты.")


def build_messages(mode: str, question: str, facts: list[dict]) -> list[dict]:
    if mode == "prompt":
        return [{"role": "system", "content": facts_system(facts)},
                {"role": "user", "content": question + ANSWER_HINT}]
    return [{"role": "system", "content": SYSTEM_NONE},
            {"role": "user", "content": question + ANSWER_HINT}]


def ollama_chat(model: str, messages: list[dict], seed: int = 42,
                timeout: int = 180) -> str:
    body = json.dumps({
        "model": model,
        "messages": messages,
        "stream": False,
        "options": {"temperature": 0, "seed": seed, "num_predict": 32},
    }).encode("utf-8")
    req = urllib.request.Request(
        "http://localhost:11434/api/chat", data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["message"]["content"]


def normalize(s: str) -> str:
    s = s.lower().replace("ё", "е")
    s = re.sub(r"[^0-9a-zа-я ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def match(gold: str, raw: str) -> tuple[bool, bool]:
    g, a = normalize(gold), normalize(raw)
    exact = g == a
    relaxed = exact or (len(g) >= 3 and g in a)
    return exact, relaxed


def safe_model_name(model: str) -> str:
    return re.sub(r"[^a-z0-9._-]", "_", model.lower())


def make_transformers_gen(args):
    """Kaggle T4: 4-bit base + adapter day-07; tuned = adapter вкл с фактами
    в system, base-* = adapter выкл. Возвращает (label, gen(mode, case))."""
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
    facts = load_jsonl(Path(args.facts))

    def gen(mode: str, case: dict) -> str:
        mapped = "prompt" if mode == "tuned" else "none"
        msgs = build_messages(mapped, case["question"], facts)
        ids = tok.apply_chat_template(
            msgs, tokenize=True, add_generation_prompt=True,
            return_tensors="pt").to(model.device)
        ctx = model.disable_adapter() if mode.startswith("base-") else None
        if ctx is not None:
            with ctx:
                out = model.generate(ids, max_new_tokens=32,
                                     do_sample=False,
                                     pad_token_id=tok.pad_token_id)
        else:
            out = model.generate(ids, max_new_tokens=32, do_sample=False,
                                 pad_token_id=tok.pad_token_id)
        return tok.decode(out[0][ids.shape[1]:], skip_special_tokens=True)

    return f"transformers+{args.adapter}", gen


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", choices=["ollama", "transformers"],
                    default="ollama")
    ap.add_argument("--model", default=None, help="имя модели Ollama")
    ap.add_argument("--config", default=None)
    ap.add_argument("--adapter", default="artifacts/adapter")
    ap.add_argument("--modes", default=None)
    ap.add_argument("--eval", default=str(DEFAULT_EVAL))
    ap.add_argument("--facts", default=str(DEFAULT_FACTS))
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    if args.backend == "ollama" and not args.model:
        ap.error("--backend ollama требует --model")
    if args.backend == "transformers" and not args.config:
        ap.error("--backend transformers требует --config")
    if args.modes is None:
        args.modes = ("none,prompt" if args.backend == "ollama"
                      else "tuned,base-none")

    cases = load_jsonl(Path(args.eval))
    facts = load_jsonl(Path(args.facts))
    modes = [m.strip() for m in args.modes.split(",") if m.strip()]
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.backend == "transformers":
        model_label, gen = make_transformers_gen(args)
    else:
        model_label = args.model

        def gen(mode, case):  # noqa: ANN001, ANN202
            return ollama_chat(args.model,
                               build_messages(mode, case["question"], facts),
                               seed=args.seed)

    results_file = out_dir / f"results_{safe_model_name(model_label)}.jsonl"
    metrics: dict[str, dict] = {}
    with open(results_file, "w", encoding="utf-8") as rf:
        for mode in modes:
            exact_hits, relaxed_hits, lat = 0, 0, []
            for case in cases:
                t0 = time.monotonic()
                raw = gen(mode, case)
                dt = (time.monotonic() - t0) * 1000
                exact, relaxed = match(case["answer"], raw)
                exact_hits += int(exact)
                relaxed_hits += int(relaxed)
                lat.append(dt)
                rf.write(json.dumps({
                    "model": model_label, "mode": mode, "fact_id": case["fact_id"],
                    "kind": case["kind"], "question": case["question"],
                    "gold": case["answer"], "raw": raw,
                    "exact": exact, "relaxed": relaxed, "latency_ms": round(dt),
                }, ensure_ascii=False) + "\n")
            metrics[mode] = {
                "n": len(cases),
                "exact": exact_hits,
                "relaxed": relaxed_hits,
                "exact_acc": round(exact_hits / len(cases), 4),
                "relaxed_acc": round(relaxed_hits / len(cases), 4),
                "latency_ms_avg": round(statistics.mean(lat)),
                "latency_ms_p95": round(sorted(lat)[int(len(lat) * 0.95)]),
            }
            print(f"[{mode}] exact {exact_hits}/{len(cases)} "
                  f"relaxed {relaxed_hits}/{len(cases)}", flush=True)

    summary = {
        "model": model_label,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "seed": args.seed,
        "modes": metrics,
    }
    (out_dir / "facts.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        f"# Facts eval — {args.model} (day-08 s1)",
        "",
        f"Сгенерировано: {summary['generated_at']}, seed={args.seed}",
        f"Кейсов: {len(cases)} (orig + para по 36 фактам).",
        "",
        "| Режим | exact | relaxed | latency avg | p95 |",
        "|---|---|---|---|---|",
    ]
    for mode, m in metrics.items():
        lines.append(
            f"| {mode} | {m['exact']}/{m['n']} ({m['exact_acc']:.0%}) | "
            f"{m['relaxed']}/{m['n']} ({m['relaxed_acc']:.0%}) | "
            f"{m['latency_ms_avg']} мс | {m['latency_ms_p95']} мс |")
    lines += [
        "",
        "- `none` — вопрос без контекста; факты выдуманные, в модели их нет.",
        "- `prompt` — все факты в system (подстановка в промпт, аналог RAG).",
        "- exact — нормализованное точное совпадение ответа; relaxed — gold "
        "входит в ответ.",
        "",
        f"Покейсово: `{results_file.name}`; метрики: `facts.json`.",
    ]
    report = out_dir / "facts_report.md"
    report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"report -> {report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
