// Локальный embedding-провайдер.
// POST на OpenAI-совместимый эндпоинт /embeddings (Ollama /v1, LM Studio, vLLM и т.п.).
// Только локальный baseURL из .env — внешний сеть-запрос запрещён (день 21+).

import { loadEnvUpward } from '../env.js';
import type { Embedder } from './types.js';

loadEnvUpward();

export interface EmbedConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export function embedConfigFromEnv(): EmbedConfig {
  const baseUrl = process.env.LOCAL_EMBED_BASE_URL?.trim();
  const model = process.env.LOCAL_EMBED_MODEL?.trim();
  if (!baseUrl || !model) {
    throw new Error(
      'Локальные эмбеддинги не настроены: задайте LOCAL_EMBED_BASE_URL и LOCAL_EMBED_MODEL в .env. ' +
        'День 21+ работает ТОЛЬКО на локальных моделях.',
    );
  }
  return { baseUrl, model, apiKey: process.env.LOCAL_EMBED_API_KEY?.trim() ?? '' };
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

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: this.config.model, input: texts }),
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
