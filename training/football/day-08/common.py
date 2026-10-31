# День 8 (футбольный трек): общие утилиты — загрузка модели, генерация,
# нормализация, близость строк. Используется всеми eval-скриптами дня.

import json
import re
from pathlib import Path

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

ROOT = Path(__file__).resolve().parent
DEFAULT_MODEL = "Qwen/Qwen2.5-0.5B-Instruct"


def load_jsonl(p):
    return [json.loads(l) for l in open(p, encoding="utf-8") if l.strip()]


def normalize(s: str) -> str:
    s = s.lower().replace("ё", "е")
    s = re.sub(r"[^0-9a-zа-я ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def match(gold: str, raw: str) -> tuple[bool, bool]:
    g, a = normalize(gold), normalize(raw)
    exact = g == a
    relaxed = exact or (len(g) >= 3 and g in a)
    return exact, relaxed


def token_f1(gold: str, raw: str) -> float:
    g, a = normalize(gold).split(), normalize(raw).split()
    if not g or not a:
        return 0.0
    gs, ac = {}, {}
    for w in g:
        gs[w] = gs.get(w, 0) + 1
    for w in a:
        ac[w] = ac.get(w, 0) + 1
    tp = sum(min(c, ac.get(w, 0)) for w, c in gs.items())
    if tp == 0:
        return 0.0
    p, r = tp / len(a), tp / len(g)
    return round(2 * p * r / (p + r), 4)


def load_model(model_name=DEFAULT_MODEL, adapter=None, threads=None):
    import os
    torch.set_num_threads(threads or max(1, (os.cpu_count() or 4) - 1))
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    base = AutoModelForCausalLM.from_pretrained(model_name, torch_dtype=torch.float32)
    if adapter:
        from peft import PeftModel
        model = PeftModel.from_pretrained(base, adapter)
    else:
        model = base
    model.eval()
    return model, tokenizer


@torch.no_grad()
def generate(model, tokenizer, messages, max_new_tokens=128):
    ids = tokenizer.apply_chat_template(
        messages, tokenize=True, add_generation_prompt=True, return_tensors="pt")
    out = model.generate(ids, attention_mask=torch.ones_like(ids),
                         max_new_tokens=max_new_tokens, do_sample=False,
                         pad_token_id=tokenizer.pad_token_id)
    return tokenizer.decode(out[0][ids.shape[1]:], skip_special_tokens=True)
