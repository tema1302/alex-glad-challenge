// Локальный embedding-провайдер.
// POST на OpenAI-совместимый эндпоинт /embeddings (Ollama /v1, LM Studio, vLLM и т.п.).
// Только локальный baseURL из .env (день 21+); сеть — через netFetch (прокси-first
// с фолбэком на прямое подключение), как весь репо.

import { loadEnvUpward, getEmbedConfig } from '../env.js';
import { netFetch } from '../net.js';
import type { Embedder } from './types.js';

loadEnvUpward();

export interface EmbedConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export function embedConfigFromEnv(): EmbedConfig {
  return getEmbedConfig();
}

interface EmbeddingsResponse {
  data: { embedding: number[] }[];
}

export class HttpEmbedder implements Embedder {
  private _dim: number | undefined;

  constructor(private readonly config: EmbedConfig) {}

  get dim(): number | undefined {
    return this._dim;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/embeddings`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;

    const resp = await netFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: this.config.model, input: texts }),
      label: 'сервис эмбеддингов',
      timeoutMs: 60_000, // батч эмбеддингов бывает дольше дефолтных 15с
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`embeddings error ${resp.status}: ${body}`);
    }
    const data = (await resp.json()) as EmbeddingsResponse;
    const vectors = data.data.map((d) => d.embedding);
    if (vectors.length > 0) this._dim = vectors[0].length;
    return vectors;
  }
}

export function makeEmbedder(): HttpEmbedder {
  return new HttpEmbedder(embedConfigFromEnv());
}
