// Резолв LLM-клиента по preference. Зеркало cli.ts makeRagLlmClient:
//   'cloud' → LlmClient (DeepSeek/OpenRouter через env.ts accessors)
//   'local' → makeLocalLlmClient() (OllamaNativeClient, наследник LlmClient)
// P0: модуль-скелет, не вызывается. P1: SSE /api/rag/query использует pickLlmClient.
import 'server-only';
import { LlmClient } from '@challenge/core/client';
import { makeLocalLlmClient } from '@challenge/core/rag/llm';

export type LlmPref = 'local' | 'cloud';

export function pickLlmClient(pref: LlmPref): LlmClient {
  return pref === 'cloud' ? new LlmClient() : makeLocalLlmClient();
}
