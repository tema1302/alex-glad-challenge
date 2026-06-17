// HTTP-клиент к OpenAI-совместимому Chat Completions API.
// Работает с любым провайдером: DeepSeek, OpenRouter, OpenAI, локальные сервера.

import 'dotenv/config';
import type { ChatMessage, ChatParams, LlmRequest, LlmResponse, Usage } from './types.js';

export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
}

function pickProvider(): ProviderConfig {
  const orKey = process.env.OPENROUTER_API_KEY?.trim();
  if (orKey) {
    return {
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: orKey,
      defaultModel: process.env.OPENROUTER_MODEL ?? 'google/gemini-2.0-flash-001',
    };
  }
  const dsKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (dsKey) {
    return {
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: dsKey,
      defaultModel: 'deepseek-chat',
    };
  }
  throw new Error(
    'Нет API-ключа. Положите в .env OPENROUTER_API_KEY или DEEPSEEK_API_KEY. См. .env.example.',
  );
}

export class LlmClient {
  private config: ProviderConfig;

  constructor(config?: ProviderConfig) {
    this.config = config ?? pickProvider();
  }

  get defaultModel(): string {
    return this.config.defaultModel;
  }

  // Низкоуровневый POST к /chat/completions. Все демо используют его.
  async chatRaw(req: LlmRequest): Promise<LlmResponse> {
    const url = `${this.config.baseUrl}/chat/completions`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(req),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`LLM API error ${resp.status}: ${body}`);
    }
    return (await resp.json()) as LlmResponse;
  }

  // Удобная обёртка: сообщения + параметры -> текст ответа.
  async chat(messages: ChatMessage[], params: ChatParams = {}): Promise<string> {
    const req: LlmRequest = {
      model: params.model ?? this.config.defaultModel,
      messages,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      stop: params.stop,
    };
    const data = await this.chatRaw(req);
    const content = data.choices[0]?.message?.content;
    if (!content) throw new Error('Пустой choices в ответе LLM');
    return content;
  }

  // chat + распакованный usage (для демо про токены).
  async chatWithUsage(
    messages: ChatMessage[],
    params: ChatParams = {},
  ): Promise<{ content: string; usage: Usage }> {
    const req: LlmRequest = {
      model: params.model ?? this.config.defaultModel,
      messages,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      stop: params.stop,
    };
    const data = await this.chatRaw(req);
    const content = data.choices[0]?.message?.content;
    if (!content) throw new Error('Пустой choices в ответе LLM');
    return { content, usage: data.usage ?? emptyUsage() };
  }
}

function emptyUsage(): Usage {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
}
