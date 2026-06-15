import type { AIConfig } from './zai';
import { getApiUrl, getModel, getHeaders } from './zai';
import { ContextCompressor, type CompressionConfig } from './contextCompressor';
import type { Question } from '@/types';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface TokenStats {
  lastRequest: TokenUsage | null;
  cumulative: TokenUsage;
  turnCount: number;
}

const MODEL_LIMITS: Record<string, number> = {
  'deepseek-chat': 65536,
  'deepseek-reasoner': 65536,
  'google/gemini-2.0-flash-001': 1048576,
  'google/gemini-2.5-flash-preview': 1048576,
  'anthropic/claude-3.5-sonnet': 200000,
  'openai/gpt-4o': 128000,
  'openai/gpt-4o-mini': 128000,
  'meta-llama/llama-3.1-70b-instruct': 131072,
};

function getModelLimit(model: string): number {
  for (const [key, limit] of Object.entries(MODEL_LIMITS)) {
    if (model.includes(key) || key.includes(model)) return limit;
  }
  return 128000;
}

const COST_PER_MILLION: Record<string, { input: number; output: number }> = {
  'deepseek-chat': { input: 0.14, output: 0.28 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
  'google/gemini-2.0-flash-001': { input: 0.075, output: 0.30 },
  'google/gemini-2.5-flash-preview': { input: 0.15, output: 0.60 },
  'openai/gpt-4o': { input: 2.50, output: 10.00 },
  'openai/gpt-4o-mini': { input: 0.15, output: 0.60 },
};

interface QAAgentConfig {
  aiConfig: AIConfig;
  compressionConfig?: Partial<CompressionConfig>;
  onTokenUpdate?: (stats: TokenStats) => void;
}

export class QAAgent {
  private config: AIConfig;
  private messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];
  private tokenStats: TokenStats;
  private onTokenUpdate?: (stats: TokenStats) => void;
  private compressor: ContextCompressor | null;

  constructor({ aiConfig, onTokenUpdate, compressionConfig }: QAAgentConfig) {
    this.config = aiConfig;
    this.onTokenUpdate = onTokenUpdate;
    this.compressor = compressionConfig ? new ContextCompressor(aiConfig, compressionConfig) : null;
    this.tokenStats = {
      lastRequest: null,
      cumulative: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      turnCount: 0,
    };
  }

  initContext(question: Question, userAnswer?: string): void {
    const correctOption = question.options.find(o => o.isCorrect);
    const systemMsg: { role: 'system'; content: string } = {
      role: 'system',
      content: `Ты — ИИ-ассистент в образовательном приложении. Помогаешь студенту понять учебный материал.

Контекст: студент ответил на вопрос теста.
Вопрос: ${question.text}
${userAnswer ? `Ответ студента: ${userAnswer}` : 'Студент ещё не ответил.'}
Правильный ответ: ${correctOption?.text ?? 'неизвестно'}
Пояснение: ${question.explanation}

Все варианты ответов:
${question.options.map(o => `${o.isCorrect ? '✓' : '✗'} ${o.text}`).join('\n')}

ПРАВИЛА:
- Отвечай на русском языке
- Объясняй просто, с аналогиями из жизни
- Если студент ошибся — объясни почему правильный ответ другой
- Если правильно — похвали и углуби понимание
- Отвечай кратко, 2-4 предложения
- Местами заставляй человека в голос проговорить важные фразы или термины
- Технические термины давай с английским в скобках`,
    };
    this.messages = [systemMsg];
  }

  restoreHistory(history: ChatMessage[]): void {
    for (const msg of history) {
      this.messages.push({ role: msg.role, content: msg.text });
    }
  }

  getTokenStats(): TokenStats {
    return { ...this.tokenStats };
  }

  getModelLimit(): number {
    return getModelLimit(getModel(this.config));
  }

  getEstimatedCost(): number {
    const model = getModel(this.config);
    const prices = COST_PER_MILLION[model];
    if (!prices) return 0;
    const inputCost = (this.tokenStats.cumulative.promptTokens / 1_000_000) * prices.input;
    const outputCost = (this.tokenStats.cumulative.completionTokens / 1_000_000) * prices.output;
    return inputCost + outputCost;
  }

  getContextUtilization(): number {
    const limit = this.getModelLimit();
    if (limit === 0) return 0;
    return this.tokenStats.cumulative.totalTokens / limit;
  }

  getCompressionStats() {
    return this.compressor?.getStats() ?? null;
  }

  async generateVisualPrompt(): Promise<string> {
    const url = this.config.provider === 'custom' ? (this.config.apiUrl || '') : getApiUrl(this.config.provider);
    const model = getModel(this.config);
    if (!url) throw new Error('API URL не настроен');

    const contextSummary = this.messages
      .filter(m => m.role !== 'system')
      .slice(-6)
      .map(m => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.content}`)
      .join('\n');

    const res = await fetch(url, {
      method: 'POST',
      headers: getHeaders(this.config),
      body: JSON.stringify({
        model,
        messages: [
          ...this.messages,
          { role: 'user', content: 'Based on our entire conversation above, describe a single vivid visual scene that captures the KEY CONCEPT we discussed. The scene should be memorable, metaphorical, and make the concept unforgettable. Return ONLY the scene description in 5-12 words in English. Example: "a glowing neural network inside a lightbulb floating above a desk, dark background". Do NOT include any text or labels in the scene.' },
        ],
        temperature: 0.9,
        max_tokens: 100,
      }),
    });

    if (!res.ok) throw new Error(`AI Error ${res.status}`);
    const data = await res.json();
    const prompt = (data?.choices?.[0]?.message?.content || '').trim();

    const usage: TokenUsage = {
      promptTokens: data?.usage?.prompt_tokens ?? 0,
      completionTokens: data?.usage?.completion_tokens ?? 0,
      totalTokens: data?.usage?.total_tokens ?? 0,
    };
    this.updateStats(usage);

    return prompt;
  }

  private updateStats(usage: TokenUsage): void {
    this.tokenStats.lastRequest = usage;
    this.tokenStats.cumulative.promptTokens += usage.promptTokens;
    this.tokenStats.cumulative.completionTokens += usage.completionTokens;
    this.tokenStats.cumulative.totalTokens += usage.totalTokens;
    this.tokenStats.turnCount++;
    this.onTokenUpdate?.(this.getTokenStats());
  }

  async send(userMessage: string): Promise<string> {
    this.messages.push({ role: 'user', content: userMessage });

    const url = this.config.provider === 'custom' ? (this.config.apiUrl || '') : getApiUrl(this.config.provider);
    const model = getModel(this.config);

    if (!url) throw new Error('API URL не настроен');
    if (!this.config.apiKey) throw new Error('API ключ не настроен');

    let contextToSend = this.messages;
    if (this.compressor && this.compressor.needsCompression(this.messages)) {
      const compressed = await this.compressor.compress(this.messages);
      contextToSend = compressed.keptMessages;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: getHeaders(this.config),
      body: JSON.stringify({
        model,
        messages: contextToSend,
        temperature: 0.7,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => '');
      throw new Error(`API Error ${response.status}: ${err}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('Пустой ответ от AI');

    // Extract token usage from API response
    const usage: TokenUsage = {
      promptTokens: data?.usage?.prompt_tokens ?? 0,
      completionTokens: data?.usage?.completion_tokens ?? 0,
      totalTokens: data?.usage?.total_tokens ?? 0,
    };
    this.updateStats(usage);

    this.messages.push({ role: 'assistant', content });
    return content;
  }

  reset(): void {
    this.messages = [];
    this.compressor?.reset();
    this.tokenStats = {
      lastRequest: null,
      cumulative: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      turnCount: 0,
    };
  }
}

export function createQAAgent(aiConfig: AIConfig, question: Question, userAnswer?: string, onTokenUpdate?: (stats: TokenStats) => void): QAAgent {
  const agent = new QAAgent({ aiConfig, onTokenUpdate });
  agent.initContext(question, userAnswer);
  return agent;
}
