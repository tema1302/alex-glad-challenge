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
}

// /api/ps — Ollama-специфичный эндпоинт (вне /v1). Берём origin из LOCAL_LLM_BASE_URL,
// никаких новых хостов/секретов. Таймаут 1500мс через AbortController — не блокируем
// демо, если сервер медленный или это не Ollama (LM Studio и т.п.).
export async function detectHardware(): Promise<HardwareInfo> {
  const cpus = os.cpus();
  const cpuModel = cpus.length > 0 ? cpus[0].model : 'unknown';
  const cpuCores = cpus.length;

  let models: number | null = null;
  try {
    const cfg = localLlmConfig();
    const origin = new URL(cfg.baseUrl).origin;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      const resp = await fetch(`${origin}/api/ps`, { signal: controller.signal });
      if (resp.ok) {
        const data = (await resp.json()) as { models?: unknown[] };
        models = Array.isArray(data.models) ? data.models.length : 0;
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
