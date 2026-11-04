// Upstream-вызов LLM для gateway: OpenAI-compatible Chat Completions и
// Anthropic Messages API. fetch инжектируется — тесты не ходят в сеть.
//
// Ошибки наружу — только статус (без тела/URL/ключа), как в core/client.ts.

import type { ChatMessage, Usage } from '../types.js';
import { netFetch } from '../net.js';
import type { GatewayUpstreamConfig } from '../env.js';

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** Fetch по умолчанию: общий netFetch (прокси-first, таймаут генерации). */
export const defaultFetch: FetchFn = (url, init = {}) => {
  const { signal, ...rest } = init;
  return netFetch(url, {
    ...rest,
    signal: signal ?? undefined,
    label: 'LLM upstream',
    timeoutMs: 120_000,
  });
};

export class UpstreamError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Upstream error ${status}`);
    this.name = 'UpstreamError';
    this.status = status;
  }
}

export interface UpstreamChatRequest {
  readonly messages: readonly ChatMessage[];
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface UpstreamChatResult {
  readonly content: string;
  readonly usage: Usage;
  readonly model: string;
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function openAiBody(cfg: GatewayUpstreamConfig, req: UpstreamChatRequest): string {
  return JSON.stringify({
    model: req.model ?? cfg.model,
    messages: req.messages,
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
  });
}

function anthropicBody(cfg: GatewayUpstreamConfig, req: UpstreamChatRequest): string {
  const system = req.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const messages = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));
  return JSON.stringify({
    model: req.model ?? cfg.model,
    messages,
    ...(system ? { system } : {}),
    max_tokens: req.maxTokens ?? 1024,
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
  });
}

function parseOpenAi(data: unknown, fallbackModel: string): UpstreamChatResult {
  const root = asRecord(data);
  const choices = asArray(root?.choices);
  const first = asRecord(choices[0]);
  const message = asRecord(first?.message);
  const content = typeof message?.content === 'string' ? message.content : '';
  if (!content) throw new Error('Upstream returned empty content');
  const usage = asRecord(root?.usage);
  return {
    content,
    usage: {
      prompt_tokens: numberOrZero(usage?.prompt_tokens),
      completion_tokens: numberOrZero(usage?.completion_tokens),
      total_tokens:
        numberOrZero(usage?.total_tokens) ||
        numberOrZero(usage?.prompt_tokens) + numberOrZero(usage?.completion_tokens),
    },
    model: typeof root?.model === 'string' ? root.model : fallbackModel,
  };
}

function parseAnthropic(data: unknown, fallbackModel: string): UpstreamChatResult {
  const root = asRecord(data);
  const parts = asArray(root?.content)
    .map((item) => asRecord(item))
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => String(item!.text));
  const content = parts.join('');
  if (!content) throw new Error('Upstream returned empty content');
  const usage = asRecord(root?.usage);
  const prompt = numberOrZero(usage?.input_tokens);
  const completion = numberOrZero(usage?.output_tokens);
  return {
    content,
    usage: {
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: prompt + completion,
    },
    model: typeof root?.model === 'string' ? root.model : fallbackModel,
  };
}

export async function callUpstream(
  cfg: GatewayUpstreamConfig,
  req: UpstreamChatRequest,
  fetchFn: FetchFn = defaultFetch,
): Promise<UpstreamChatResult> {
  const isAnthropic = cfg.provider === 'anthropic';
  const url = isAnthropic
    ? `${trimSlash(cfg.baseUrl)}/v1/messages`
    : `${trimSlash(cfg.baseUrl)}/chat/completions`;
  const headers: Record<string, string> = isAnthropic
    ? {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      }
    : {
        'content-type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      };

  const resp = await fetchFn(url, {
    method: 'POST',
    headers,
    body: isAnthropic ? anthropicBody(cfg, req) : openAiBody(cfg, req),
  });

  if (!resp.ok) {
    // Дренируем тело, чтобы не держать соединение, но не используем его в тексте.
    await resp.text().catch(() => {});
    throw new UpstreamError(resp.status);
  }

  const data: unknown = await resp.json().catch(() => null);
  return isAnthropic
    ? parseAnthropic(data, req.model ?? cfg.model)
    : parseOpenAi(data, req.model ?? cfg.model);
}
