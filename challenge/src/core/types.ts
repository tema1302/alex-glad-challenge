// Типы, совместимые с OpenAI Chat Completions API.

export type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: Role;
  content: string;
}

export const msg = {
  system: (content: string): ChatMessage => ({ role: 'system', content }),
  user: (content: string): ChatMessage => ({ role: 'user', content }),
  assistant: (content: string): ChatMessage => ({ role: 'assistant', content }),
};

export interface ChatParams {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  // День 29 (локальная оптимизация): размер контекстного окна и seed — Ollama
  // honour'ит (options.num_ctx/options.seed), cloud-провайдеры игнорируют.
  // Провайдер-нейтральная семантика: не leaking Ollama-специфику в общий тип.
  numCtx?: number;
  seed?: number;
}

// День 29: тайминги ответа локальной модели (нс → мс, /1e6). Из /api/chat duration-полей.
// base LlmClient (OpenAI-compat) их не имеет → timings остаётся undefined.
export interface LlmTimings {
  totalMs: number;
  evalMs: number;
  promptMs: number;
  loadMs: number;
}

export interface LlmRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stop?: string[];
}

export interface LlmResponse {
  id?: string;
  model?: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason?: string;
  }>;
  usage?: Usage;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}
