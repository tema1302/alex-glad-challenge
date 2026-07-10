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
  LlmTimings,
  Usage,
} from '../types.js';
import { loadEnvUpward, getLocalLlmConfig } from '../env.js';

loadEnvUpward();

export interface LocalLlmConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export function localLlmConfig(): LocalLlmConfig {
  return getLocalLlmConfig();
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

// День 29: нс → мс (/1e6) из Ollama duration-полей. Нет поля → 0.
function nsToMs(v: number | undefined): number {
  return typeof v === 'number' ? Math.round(v / 1e6) : 0;
}
function parseTimings(d: NativeChatResponse): LlmTimings {
  return {
    totalMs: nsToMs(d.total_duration),
    evalMs: nsToMs(d.eval_duration),
    promptMs: nsToMs(d.prompt_eval_duration),
    loadMs: nsToMs(d.load_duration),
  };
}

interface NativeChatResult {
  content: string;
  usage: Usage;
  doneReason?: string;
  timings?: LlmTimings;
}

interface NativeChatResponse {
  message?: { role?: string; content?: string };
  done?: boolean;
  done_reason?: string;
  eval_count?: number;
  prompt_eval_count?: number;
  // День 29: Ollama /api/chat duration-поля (нс). Парсим → ms (/1e6) в timings.
  total_duration?: number;
  eval_duration?: number;
  prompt_eval_duration?: number;
  load_duration?: number;
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
    numCtx?: number;
    seed?: number;
    stop?: string[];
  }): Promise<NativeChatResult> {
    const url = `${this.ollamaOrigin}/api/chat`;
    const options: Record<string, unknown> = {
      num_predict: typeof req.numPredict === 'number' ? req.numPredict : LOCAL_DEFAULT_NUM_PREDICT,
    };
    if (typeof req.temperature === 'number') options.temperature = req.temperature;
    if (typeof req.numCtx === 'number') options.num_ctx = req.numCtx;
    if (typeof req.seed === 'number') options.seed = req.seed;
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
      timings: parseTimings(data),
    };
  }

  override async chat(messages: ChatMessage[], params: ChatParams = {}): Promise<string> {
    const { content } = await this.postChat({
      messages,
      temperature: params.temperature,
      numPredict: params.maxTokens,
      numCtx: params.numCtx,
      seed: params.seed,
      stop: params.stop,
    });
    if (!content) throw new Error('Пустой content в ответе Ollama /api/chat');
    return content;
  }

  override async chatWithUsage(
    messages: ChatMessage[],
    params: ChatParams = {},
  ): Promise<{ content: string; usage: Usage; timings?: LlmTimings }> {
    const { content, usage, timings } = await this.postChat({
      messages,
      temperature: params.temperature,
      numPredict: params.maxTokens,
      numCtx: params.numCtx,
      seed: params.seed,
      stop: params.stop,
    });
    if (!content) throw new Error('Пустой content в ответе Ollama /api/chat');
    return { content, usage, timings };
  }

  // Потоковый нативный /api/chat (день 28, web P1): stream:true, think:false (тот же
  // фикс thinking-моделей, что в postChat). NDJSON — по строке JSON на чанк, yield
  // message.content пока не придёт done:true. На !resp.ok — throw только со status.
  // signal (follow-up P5 В3): прокидывается в fetch (AbortError при disconnect SSE).
  override async *chatStream(
    messages: ChatMessage[],
    params: ChatParams = {},
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    const url = `${this.ollamaOrigin}/api/chat`;
    const options: Record<string, unknown> = {
      num_predict: typeof params.maxTokens === 'number' ? params.maxTokens : LOCAL_DEFAULT_NUM_PREDICT,
    };
    if (typeof params.temperature === 'number') options.temperature = params.temperature;
    if (typeof params.numCtx === 'number') options.num_ctx = params.numCtx;
    if (typeof params.seed === 'number') options.seed = params.seed;
    if (params.stop && params.stop.length > 0) options.stop = params.stop;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.ollamaApiKey}`,
      },
      body: JSON.stringify({
        model: this.defaultModel,
        messages,
        stream: true,
        think: false,
        options,
      }),
      signal,
    });
    if (!resp.ok) {
      const s = resp.status;
      await resp.text().catch(() => {});
      throw new Error(`Ollama /api/chat stream error ${s}`);
    }
    if (!resp.body) throw new Error('Ollama stream: пустое тело ответа');
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          try {
            const data = JSON.parse(line) as NativeChatResponse;
            const delta = data.message?.content;
            if (delta) yield delta;
            if (data.done === true) return;
          } catch {
            // partial NDJSON line across read boundary — пропускаем
          }
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // already released
      }
    }
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
