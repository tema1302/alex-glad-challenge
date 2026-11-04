// Cost tracking для gateway: токены из usage провайдера -> стоимость в USD.
// Прайсы — ориентировочные публичные ставки (per 1M tokens); проект может
// переопределить их через конструктор. Это не биллинг, а оценка для аудита.

import type { Usage } from '../types.js';

export interface ModelPrice {
  readonly inputPer1M: number;
  readonly outputPer1M: number;
}

export const DEFAULT_PRICES: Readonly<Record<string, ModelPrice>> = {
  'deepseek-chat': { inputPer1M: 0.27, outputPer1M: 1.1 },
  'deepseek-reasoner': { inputPer1M: 0.55, outputPer1M: 2.19 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10 },
  'claude-3-5-haiku': { inputPer1M: 0.8, outputPer1M: 4 },
  'claude-3-5-sonnet': { inputPer1M: 3, outputPer1M: 15 },
  'claude-3-haiku': { inputPer1M: 0.25, outputPer1M: 1.25 },
};

const FALLBACK_PRICE: ModelPrice = { inputPer1M: 0.5, outputPer1M: 1.5 };

export function priceForModel(
  model: string,
  prices: Readonly<Record<string, ModelPrice>> = DEFAULT_PRICES,
): ModelPrice {
  const normalized = model.trim().toLowerCase();
  let best: { key: string; price: ModelPrice } | null = null;
  for (const [key, price] of Object.entries(prices)) {
    if (normalized.startsWith(key) && (!best || key.length > best.key.length)) {
      best = { key, price };
    }
  }
  return best?.price ?? FALLBACK_PRICE;
}

export interface CostBreakdown {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly inputUsd: number;
  readonly outputUsd: number;
  readonly totalUsd: number;
  readonly price: ModelPrice;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function costForUsage(
  model: string,
  usage: Usage,
  prices: Readonly<Record<string, ModelPrice>> = DEFAULT_PRICES,
): CostBreakdown {
  const inputTokens = Math.max(0, usage.prompt_tokens || 0);
  const outputTokens = Math.max(0, usage.completion_tokens || 0);
  const price = priceForModel(model, prices);
  const inputUsd = (inputTokens / 1e6) * price.inputPer1M;
  const outputUsd = (outputTokens / 1e6) * price.outputPer1M;
  return {
    model,
    inputTokens,
    outputTokens,
    inputUsd: round6(inputUsd),
    outputUsd: round6(outputUsd),
    totalUsd: round6(inputUsd + outputUsd),
    price,
  };
}

export class CostTracker {
  private requests = 0;
  private totalUsd = 0;
  private inputTokens = 0;
  private outputTokens = 0;

  add(cost: CostBreakdown): void {
    this.requests += 1;
    this.totalUsd = round6(this.totalUsd + cost.totalUsd);
    this.inputTokens += cost.inputTokens;
    this.outputTokens += cost.outputTokens;
  }

  snapshot(): {
    requests: number;
    totalUsd: number;
    inputTokens: number;
    outputTokens: number;
  } {
    return {
      requests: this.requests,
      totalUsd: this.totalUsd,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
    };
  }
}
