// Локальный LLM-клиент для дней 21+.
// СТРОГО локальный эндпоинт из .env (LOCAL_LLM_BASE_URL/MODEL).
// Внешние провайдеры (DeepSeek/OpenRouter) НЕ используются. Если эндпоинт не задан —
// бросаем ошибку и просим пользователя вмешаться (не обходить ограничение).

import { LlmClient } from '../client.js';
import type {
  ChatMessage,
  ChatParams,
  LlmRequest,
  LlmResponse,
  Usage,
} from '../types.js';
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

// Страховка от зависания thinking-моделей (qwen3.5:4b без лимита бежит бесконечно).
// 1024 токена покрывают и короткий RAG-ответ, и rerank-JSON; не подавляют валидный ответ.
const LOCAL_DEFAULT_NUM_PREDICT = 1024;

// Ollama origin: отрезаем OpenAI-compat суффикс /v1 и trailing slash, чтобы получить
// нативный base (http://localhost:11434/v1 → http://localhost:11434). Не хардкодим хост —
// honour LOCAL_LLM_BASE_URL.
function ollamaOrigin(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (trimmed.endsWith('/v1')) return trimmed.slice(0, -3);
  return trimmed;
}

interface NativeChatResult {
  content: string;
  usage: Usage;
  doneReason?: string;
}

interface NativeChatResponse {
  message?: { role?: string; content?: string };
  done?: boolean;
  done_reason?: string;
  eval_count?: number;
  prompt_eval_count?: number;
}

/**
 * Локальный клиент к нативному Ollama /api/chat (НЕ OpenAI-compat /v1/chat/completions).
 *
 * Зачем: thinking-модели (qwen3.5:4b) по /v1/chat/completions не отключают thinking —
 * весь бюджет уходит в message.reasoning, content пуст. Нативный /api/chat принимает
 * think:false и возвращает content без reasoning-расхода (верифицировано curl).
 *
 * extends LlmClient: даёт структурную совместимость (private config origin-aware —
 * независимый класс LlmClient не присваивается, только наследник) и наследуемый
 * defaultModel. Все LLM-методы переопределены на нативный /api/chat; baseUrl/apiKey из
 * super.config не используются (super вызывает только для совместимости типов).
 */
export class OllamaNativeClient extends LlmClient {
  private readonly ollamaOrigin: string;
  private readonly ollamaApiKey: string;

  constructor(cfg: LocalLlmConfig) {
    super({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey || 'local', defaultModel: cfg.model });
    this.ollamaOrigin = ollamaOrigin(cfg.baseUrl);
    this.ollamaApiKey = cfg.apiKey || 'local';
  }

  private async postChat(req: {
    messages: ChatMessage[];
    temperature?: number;
    numPredict?: number;
    stop?: string[];
  }): Promise<NativeChatResult> {
    const url = `${this.ollamaOrigin}/api/chat`;
    const options: Record<string, unknown> = {
      num_predict: typeof req.numPredict === 'number' ? req.numPredict : LOCAL_DEFAULT_NUM_PREDICT,
    };
    if (typeof req.temperature === 'number') options.temperature = req.temperature;
    if (req.stop && req.stop.length > 0) options.stop = req.stop;

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.ollamaApiKey}`,
      },
      body: JSON.stringify({
        model: this.defaultModel,
        messages: req.messages,
        stream: false,
        think: false,
        options,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Ollama /api/chat error ${resp.status}: ${body}`);
    }
    const data = (await resp.json()) as NativeChatResponse;
    const content = data.message?.content ?? '';
    const completion = data.eval_count ?? 0;
    const prompt = data.prompt_eval_count ?? 0;
    return {
      content,
      usage: {
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: prompt + completion,
      },
      doneReason: data.done_reason,
    };
  }

  override async chat(messages: ChatMessage[], params: ChatParams = {}): Promise<string> {
    const { content } = await this.postChat({
      messages,
      temperature: params.temperature,
      numPredict: params.maxTokens,
      stop: params.stop,
    });
    if (!content) throw new Error('Пустой content в ответе Ollama /api/chat');
    return content;
  }

  override async chatWithUsage(
    messages: ChatMessage[],
    params: ChatParams = {},
  ): Promise<{ content: string; usage: Usage }> {
    const { content, usage } = await this.postChat({
      messages,
      temperature: params.temperature,
      numPredict: params.maxTokens,
      stop: params.stop,
    });
    if (!content) throw new Error('Пустой content в ответе Ollama /api/chat');
    return { content, usage };
  }

  // Адаптер нативного ответа → OpenAI-compat LlmResponse. RAG не зовёт chatRaw напрямую,
  // но тип LlmClient его требует — возвращаем минимально совместимую структуру.
  override async chatRaw(req: LlmRequest): Promise<LlmResponse> {
    const { content, usage, doneReason } = await this.postChat({
      messages: req.messages,
      temperature: req.temperature,
      numPredict: req.max_tokens,
      stop: req.stop,
    });
    return {
      model: this.defaultModel,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: doneReason ?? 'stop',
        },
      ],
      usage,
    };
  }
}

/**
 * Локальный клиент: нативный Ollama /api/chat с think:false (Fix A для thinking-моделей).
 * Возвращает OllamaNativeClient (наследник LlmClient, структурно совместим).
 */
export function makeLocalLlmClient(): LlmClient {
  return new OllamaNativeClient(localLlmConfig());
}
