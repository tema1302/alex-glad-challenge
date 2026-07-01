// Локальный LLM-клиент для дней 21+.
// СТРОГО локальный эндпоинт из .env (LOCAL_LLM_BASE_URL/MODEL).
// Внешние провайдеры (DeepSeek/OpenRouter) НЕ используются. Если эндпоинт не задан —
// бросаем ошибку и просим пользователя вмешаться (не обходить ограничение).

import { LlmClient } from '../client.js';
import type { ProviderConfig } from '../client.js';
import { loadEnvUpward } from '../env.js';

loadEnvUpward();

export interface LocalLlmConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export function localLlmConfig(): LocalLlmConfig {
  const baseUrl = process.env.LOCAL_LLM_BASE_URL?.trim();
  const model = process.env.LOCAL_LLM_MODEL?.trim();
  if (!baseUrl || !model) {
    throw new Error(
      'Локальный LLM не настроен: задайте LOCAL_LLM_BASE_URL и LOCAL_LLM_MODEL в .env. ' +
        'День 21+ работает ТОЛЬКО на локальных моделях. Если локальная модель не справляется — ' +
        'попросите пользователя вмешаться явно.',
    );
  }
  return { baseUrl, model, apiKey: process.env.LOCAL_LLM_API_KEY?.trim() ?? '' };
}

/**
 * LlmClient, настроенный на локальный сервер.
 * apiKey='local' когда не задан: LlmClient шлёт `Authorization: Bearer <apiKey>`,
 * локальные серверы (Ollama/LM Studio) его игнорируют, но пустой заголовок
 * часть серверов отклоняет.
 */
export function makeLocalLlmClient(): LlmClient {
  const cfg = localLlmConfig();
  const config: ProviderConfig = {
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey || 'local',
    defaultModel: cfg.model,
  };
  return new LlmClient(config);
}
