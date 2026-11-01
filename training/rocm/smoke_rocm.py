# Смоук ROCm-окружения (training/.venv-rocm): PyTorch+HIP на RX 7600 и NF4 bitsandbytes.
# Запуск: training/.venv-rocm/Scripts/python.exe training/rocm/smoke_rocm.py
# Проверки: cuda_available (ROCm-HIP), matmul fp32/fp16 на GPU,
# bitsandbytes Linear4bit (NF4) forward+backward на GPU.
# Результат пишется в artifacts/smoke_rocm.json (в git не попадает).

import importlib.metadata
import json
import platform
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import bitsandbytes as bnb
import torch

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "artifacts"


def timed_matmul(device: str, dtype: torch.dtype, n: int = 2048) -> dict:
    a = torch.randn(n, n, device=device, dtype=dtype)
    b = torch.randn(n, n, device=device, dtype=dtype)
    torch.cuda.synchronize()
    t0 = time.perf_counter()
    c = a @ b
    torch.cuda.synchronize()
    dt = time.perf_counter() - t0
    err = (c - a @ b).abs().max().item() if dtype == torch.float32 else None
    return {
        "device": device,
        "dtype": str(dtype).replace("torch.", ""),
        "size": n,
        "wall_s": round(dt, 4),
        "approx_tflops": round((2 * n**3) / dt / 1e12, 2),
        "determinism_max_err": err,
    }


def nf4_linear(device: str) -> dict:
    torch.manual_seed(42)
    linear = bnb.nn.Linear4bit(64, 32, bias=False, compute_dtype=torch.float16)
    weight = torch.randn(32, 64, dtype=torch.float16)
    linear.weight = bnb.nn.Params4bit(
        weight, quant_type="nf4", requires_grad=False
    ).to(device)
    quant_state_ok = getattr(linear.weight, "quant_state", None) is not None
    x = torch.randn(8, 64, dtype=torch.float16, device=device, requires_grad=True)
    out = linear(x)
    loss = out.sum()
    loss.backward()
    return {
        "out_shape": list(out.shape),
        "out_dtype": str(out.dtype).replace("torch.", ""),
        "out_finite": bool(torch.isfinite(out.float()).all().item()),
        "quant_state_ok": quant_state_ok,
        "grad_on_input": x.grad is not None,
    }


def main() -> int:
    report: dict = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "packages": {
            "torch": torch.__version__,
            "hip": torch.version.hip,
            "bitsandbytes": importlib.metadata.version("bitsandbytes"),
            "transformers": importlib.metadata.version("transformers"),
            "peft": importlib.metadata.version("peft"),
            "accelerate": importlib.metadata.version("accelerate"),
            "numpy": importlib.metadata.version("numpy"),
        },
    }
    report["cuda_available"] = torch.cuda.is_available()
    if not report["cuda_available"]:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        print("FAIL: torch.cuda is not available")
        return 1

    report["device_name"] = torch.cuda.get_device_name(0)
    report["device_capability"] = ".".join(map(str, torch.cuda.get_device_capability(0)))
    report["vram_total_gb"] = round(
        torch.cuda.get_device_properties(0).total_memory / 2**30, 1
    )

    report["matmul_fp32"] = timed_matmul("cuda", torch.float32)
    report["matmul_fp16"] = timed_matmul("cuda", torch.float16)
    report["nf4_linear"] = nf4_linear("cuda")
    torch.cuda.synchronize()
    report["vram_peak_mb"] = round(torch.cuda.max_memory_allocated() / 2**20, 1)

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "smoke_rocm.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    ok = report["nf4_linear"]["out_finite"] and report["nf4_linear"]["grad_on_input"]
    print("SMOKE", "OK" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
