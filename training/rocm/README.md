# ROCm-окружение: локальное обучение на AMD RX 7600 (Windows)

Локальный GPU-путь для рецептов day-06/07 (QLoRA NF4 через bitsandbytes) на
AMD Radeon RX 7600 (gfx1102) под Windows 11 — без Kaggle T4. Основан на
TheRock (ROCm 7.14+, release-система ROCm): **gfx1102 на Windows — Release
Ready** (Build Passing / Sanity Tested / Release Ready в
`SUPPORTED_GPUS.md`), и на bitsandbytes ≥0.49: Windows + AMD GPU RDNA
gfx110X — **QLoRA 4-bit ✅** (исходная premise «bnb = только NVIDIA»
устарела).

## Установка (повторяемо)

```powershell
# 1. Python 3.12 (user-scope, путь без пробелов)
winget install --id Python.Python.3.12 --scope user

# 2. venv рядом с существующим CPU-окружением (training/.venv не трогаем)
py -3.12 -m venv training\.venv-rocm

# 3. torch с ROCm-HIP — только со stable-индекса TheRock (~1.1 ГБ)
training\.venv-rocm\Scripts\python.exe -m pip install `
  --index-url https://stable.repo.amd.com/rocm/whl-next/ "torch[device-gfx1102]"

# 4. остальной стек (pins — requirements-rocm.txt)
training\.venv-rocm\Scripts\python.exe -m pip install `
  -r training\rocm\requirements-rocm.txt
```

Фактические версии (2026-11-01): torch 2.14.0+rocm10.1.0 (HIP 7.16.26385),
bitsandbytes 0.50.2, transformers 4.46.3 (пин к рецепту), peft 0.21.2,
accelerate 1.15.0, datasets 3.1.0 (совместима с hub 0.36 пина transformers).

## Smoke

```powershell
training\.venv-rocm\Scripts\python.exe training\rocm\smoke_rocm.py
```

Проверяет `torch.cuda.is_available()` (ROCm-HIP), matmul fp32/fp16 и
**bitsandbytes NF4 Linear4bit forward+backward на GPU**; отчёт —
`artifacts/smoke_rocm.json`. Результат 2026-11-01: device
AMD Radeon RX 7600, capability 11.0, VRAM 8.0 ГБ, NF4 ok.

## Прогон рецепта day-06 (срез, методология не меняется)

```powershell
training\.venv-rocm\Scripts\python.exe training\day-06\train_qlora.py `
  --config ../rocm/configs/qlora-smoke.yaml
```

Скрипт рецепта не меняется; smoke-конфиг отличается только объёмом (срезы
датасета 200/40, 1 эпоха) и путём артефактов. Результат: train_loss
0.3129→0.1515, eval_loss 0.156, VRAM пик 3.31 ГБ, ~6.9 с/шаг, tokens/s
~970–1320. T4-референс полного прогона: 46.4 мин / 600 шагов (~4.6 с/шаг),
VRAM ≤ 2.68 ГБ (docs/advanced-day-06/README.md). Экстраполяция полного
рецепта на RX 7600: ~1.3–1.7 ч. Числовое равенство с T4 не гарантируется —
другое железо и fp16-ядра.

## Ограничения и известные предупреждения

- **Triton на Windows — 🚧** в TheRock; apex — ❌. Для NF4/transformers/peft
  не нужны; влияет только на flop-counter-ворнинг torch.
- bnb печатает «No prebuilt binary for ROCm 7.16, loading ROCm 7.15
  instead» — fallback-бинарь; можно переопределить `BNB_ROCM_VERSION`.
- bnb: «Could not detect ROCm GPU architecture: WinError 2» — детект-команда
  не работает на Windows; на работу ядер не влияет.
- `paged_adamw_8bit` на ROCm/HIP работает (проверено прогоном).
- HF-кэш на Windows без Developer Mode — симлинк-ворнинг (косметика).
- Драйвер: Adrenalin 32.0.32015 — свежий; TheRock рекомендует последний.

## Источники

- TheRock `RELEASES.md` — установка multi-arch Python-пакетов, stable-индекс
  `https://stable.repo.amd.com/rocm/whl-next/`, экстра `torch[device-gfx1102]`.
- TheRock `SUPPORTED_GPUS.md` — статус gfx1102 на Windows (✅/✅/✅).
- bitsandbytes README — таблица accelerator support: Windows AMD RDNA
  gfx110X — QLoRA 4-bit ✅.
