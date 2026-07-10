// Загрузка .env из корня репозитория (вверх от cwd).
// Импортируется из точки входа cli.ts, чтобы переменные были доступны
// всем модулям, включая telegram.ts, даже если LlmClient не используется.

import { config as dotenvConfig } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { dataPath } from './paths.js';

let loaded = false;

export function loadEnvUpward(): void {
  if (loaded) return;
  loaded = true;

  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, '.env'))) {
      dotenvConfig({ path: path.join(dir, '.env') });
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dotenvConfig();
}

// --- Typed env-accessors ---
//
// Единая точка чтения секретов/конфигов: значения НЕ попадают в error-сообщения
// (только имена переменных), не логируются здесь. Секретоносные поля возвращаются
// как есть — потребитель не должен их печатать. Все строки — .trim(), пустые → ''
// или null/undefined-возврат.

/** Конфиг cloud-LLM: DeepSeek (приоритет) или OpenRouter. Бросает generic-ошибку. */
export interface LlmProviderConfig {
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
}

export function getLlmProviderConfig(): LlmProviderConfig {
  const dsKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (dsKey) {
    return {
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: dsKey,
      defaultModel: process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-chat',
    };
  }
  const orKey = process.env.OPENROUTER_API_KEY?.trim();
  if (orKey) {
    return {
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: orKey,
      defaultModel: process.env.OPENROUTER_MODEL?.trim() || 'google/gemini-3.5-flash',
    };
  }
  throw new Error(
    'Нет API-ключа LLM: задайте DEEPSEEK_API_KEY или OPENROUTER_API_KEY в .env. См. .env.example.',
  );
}

/** Конфиг локального LLM (Ollama). Бросает generic-ошибку без значений. */
export interface LocalLlmConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export function getLocalLlmConfig(): LocalLlmConfig {
  const baseUrl = process.env.LOCAL_LLM_BASE_URL?.trim();
  const model = process.env.LOCAL_LLM_MODEL?.trim();
  if (!baseUrl || !model) {
    throw new Error(
      'Локальный LLM не настроен: задайте LOCAL_LLM_BASE_URL и LOCAL_LLM_MODEL в .env.',
    );
  }
  return { baseUrl, model, apiKey: process.env.LOCAL_LLM_API_KEY?.trim() ?? '' };
}

/** Конфиг локальных эмбеддингов. Бросает generic-ошибку без значений. */
export interface EmbedConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export function getEmbedConfig(): EmbedConfig {
  const baseUrl = process.env.LOCAL_EMBED_BASE_URL?.trim();
  const model = process.env.LOCAL_EMBED_MODEL?.trim();
  if (!baseUrl || !model) {
    throw new Error(
      'Локальные эмбеддинги не настроены: задайте LOCAL_EMBED_BASE_URL и LOCAL_EMBED_MODEL в .env.',
    );
  }
  return { baseUrl, model, apiKey: process.env.LOCAL_EMBED_API_KEY?.trim() ?? '' };
}

/** MTProto session: env TG_SESSION (приоритет) либо .data/tg-session.json. null если нет. */
function readTgSession(): string | null {
  const env = process.env.TG_SESSION;
  if (env && env.trim()) return env.trim();
  try {
    const obj = JSON.parse(readFileSync(dataPath('tg-session.json'), 'utf8')) as {
      session?: unknown;
    };
    if (typeof obj.session === 'string' && obj.session.trim()) return obj.session.trim();
  } catch {
    /* файла нет или битый — не страшно */
  }
  return null;
}

/** Конфиг MTProto-scan (userbot). null если что-то из apiId/apiHash/session отсутствует. */
export interface TgScanConfig {
  apiId: number;
  apiHash: string;
  session: string;
}

export function getTgScanConfig(): TgScanConfig | null {
  const apiIdRaw = process.env.TG_API_ID?.trim();
  const apiHash = process.env.TG_API_HASH?.trim();
  const session = readTgSession();
  if (!apiIdRaw || !apiHash || !session) return null;
  const apiId = Number(apiIdRaw);
  if (!Number.isFinite(apiId)) return null;
  return { apiId, apiHash, session };
}

/** TCP-туннель к Telegram DC (socat на прокси). Дефолты — публичные хост/порт. */
export function getTgTunnel(): { host: string; port: number } {
  return {
    host: process.env.TG_TUNNEL_HOST?.trim() || '91.199.147.131',
    port: Number(process.env.TG_TUNNEL_PORT) || 8081,
  };
}

/** topicId по умолчанию для TG-команд (env TG_TOPIC). Числовой override. */
export function getTgTopic(): number | undefined {
  const raw = process.env.TG_TOPIC?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Bot API config для публикации/уведомлений. null если токен/chatId отсутствуют. */
export function getTgBotConfig(): { botToken: string; chatId: string } | null {
  const botToken = process.env.TG_BOT_TOKEN?.trim();
  const chatId = process.env.TG_CHAT_ID?.trim();
  if (!botToken || !chatId) return null;
  return { botToken, chatId };
}

/** Опциональный bearer-токен для auth на MCP HTTP-сервере. undefined если не задан. */
export function getMcpAuth(): string | undefined {
  const token = process.env.MCP_AUTH_TOKEN?.trim();
  return token || undefined;
}
