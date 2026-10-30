// Резолв LLM-клиента по preference. Зеркало cli.ts makeRagLlmClient:
//   'cloud' → LlmClient (DeepSeek/OpenRouter через env.ts accessors)
//   'local' → OllamaNativeClient на конфиге localLlmConfig с активной моделью
//             из runtime-переключателя (day-10): без override — дефолт env.
import 'server-only';
import { LlmClient } from '@challenge/core/client';
import { makeLocalLlmClient } from '@challenge/core/rag/llm';
import { localLlmConfig, OllamaNativeClient } from '@challenge/core/rag/llm';
import { getLocalModelState } from './local-model-switch';

export type LlmPref = 'local' | 'cloud';

export function pickLlmClient(pref: LlmPref): LlmClient {
  if (pref === 'cloud') return new LlmClient();
  const cfg = localLlmConfig();
  const { active, switchable } = getLocalModelState();
  if (!switchable || !active || active === cfg.model) {
    return makeLocalLlmClient();
  }
  return new OllamaNativeClient({ ...cfg, model: active });
}
