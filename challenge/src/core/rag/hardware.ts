// Детектор железа (день 23): CPU всегда через os.cpus(); runtime — best-effort через
// /api/ps уже настроенного локального эндпоинта. GPU ВСЕГДА null: Ollama /api/ps не
// отдаёт GPU-инфо — честно не выдумываем (не нарушаем принцип «не врать про мощности»).

import os from 'node:os';
import { localLlmConfig } from './llm.js';

export interface HardwareInfo {
  cpuModel: string;
  cpuCores: number;
  llmRuntime: string;
  gpu: string | null;
  source: 'os.cpus' | '/api/ps' | 'fallback';
  // День 29: VRAM-footprint загруженных моделей. /api/ps models[].size_vram (видимая
  // VRAM) и size (общий размер модели в памяти). Сумма по всем loaded. Undefined,
  // если /api/ps недоступен или не отдал size_vram (никаких выдуманных чисел).
  modelVramBytes?: number;
  modelSizeBytes?: number;
}

// /api/ps — Ollama-специфичный эндпоинт (вне /v1). Берём origin из LOCAL_LLM_BASE_URL,
// никаких новых хостов/секретов. Таймаут 1500мс через AbortController — не блокируем
// демо, если сервер медленный или это не Ollama (LM Studio и т.п.).
export async function detectHardware(): Promise<HardwareInfo> {
  const cpus = os.cpus();
  const cpuModel = cpus.length > 0 ? cpus[0].model : 'unknown';
  const cpuCores = cpus.length;

  let models: number | null = null;
  let modelVramBytes: number | undefined;
  let modelSizeBytes: number | undefined;
  try {
    const cfg = localLlmConfig();
    const origin = new URL(cfg.baseUrl).origin;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      const resp = await fetch(`${origin}/api/ps`, { signal: controller.signal });
      if (resp.ok) {
        const data = (await resp.json()) as { models?: Array<{ size_vram?: number; size?: number }> };
        const loaded = Array.isArray(data.models) ? data.models : [];
        models = loaded.length;
        let vramSum = 0;
        let sizeSum = 0;
        let anySize = false;
        for (const m of loaded) {
          if (typeof m.size_vram === 'number') {
            vramSum += m.size_vram;
            anySize = true;
          }
          if (typeof m.size === 'number') sizeSum += m.size;
        }
        if (anySize) {
          modelVramBytes = vramSum;
          modelSizeBytes = sizeSum;
        }
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    models = null;
  }

  if (models !== null) {
    return {
      cpuModel,
      cpuCores,
      llmRuntime: `Ollama (${models} models loaded)`,
      gpu: null,
      source: '/api/ps',
      modelVramBytes,
      modelSizeBytes,
    };
  }
  return {
    cpuModel,
    cpuCores,
    llmRuntime: 'CPU-only (assumed)',
    gpu: null,
    source: 'fallback',
  };
}
