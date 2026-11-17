// Единая точка исходящих HTTP из core: LLM-провайдер, RSS, форумы, Bot API.
//
// Проблема, которую закрывает: жёсткая привязка каждого call-site к «или напрямую,
// или через прокси». При лежащем локальном прокси (HTTPS_PROXY, напр. gost/v2ray на
// 127.0.0.1) LLM-вызовы падали с сырым «fetch failed» и убивали весь pipeline
// (SSE → {"type":"error","message":"fetch failed"}), а зарубежные RSS без прокси
// были недоступны напрямую. Стратегия netFetch: если прокси задан — сначала через
// него, при сетевом фейле — напрямую (и наоборот порядка нет: прокси-first покрывает
// и блокируемые хосты, и domestic). Исчерпание попыток → человекочитаемая ошибка
// с label (без URL/ключей; наружу всё равно уходит через safeMessage на вебе).
//
// Таймаут: по умолчанию 15с; для потоковых LLM-ответов передавайте timeoutMs:null —
// тогда ограничение только внешним signal (AbortSignal.any объединяет).

import { ProxyAgent } from 'undici';
import { getHttpsProxy } from './env.js';

const DEFAULT_TIMEOUT_MS = 15_000;

// ProxyAgent на строку прокси — переиспользуем пул соединений между вызовами.
const agents = new Map<string, ProxyAgent>();
function agentFor(proxy: string): ProxyAgent {
  let agent = agents.get(proxy);
  if (!agent) {
    agent = new ProxyAgent(proxy);
    agents.set(proxy, agent);
  }
  return agent;
}

export interface NetFetchInit extends Omit<RequestInit, 'signal'> {
  /** Человекочитаемое имя цели для сообщения об ошибке (без URL — это не секрет-значение, но URL в тексте бесполезен). */
  label?: string;
  /** Таймаут попытки, мс. null — без таймаута (потоковые ответы; ограничение только signal). */
  timeoutMs?: number | null;
  /** Внешний сигнал отмены (клиентский SSE-disconnect) — не ретраится. */
  signal?: AbortSignal;
  /**
   * false — при сетевом фейле НЕ повторять запрос на другой канал (прокси → напрямую).
   * Для неидемпотентных POST (sendDocument и т. п.): Telegram может принять первый
   * запрос, но ответ потерять — повтор создаст второе сообщение. По умолчанию true
   * (RSS/LLM-вызовы повторять безопасно).
   */
  retryOnNetworkError?: boolean;
}

export async function netFetch(url: string, init: NetFetchInit = {}): Promise<Response> {
  const {
    label,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
    retryOnNetworkError = true,
    ...rest
  } = init;
  const proxy = getHttpsProxy();

  // Loopback (локальные Ollama/embeddings/MCP) — ВСЕГДА напрямую, даже при заданном
  // HTTPS_PROXY: hop через внешний прокси для 127.0.0.1 бессмыслен, а при мёртвом
  // прокси превращает живой локальный сервис в «сеть недоступна».
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    target = new URL('http://invalid.invalid/');
  }
  const isLoopback =
    target.hostname === 'localhost' ||
    target.hostname === '127.0.0.1' ||
    target.hostname === '::1' ||
    target.hostname === '[::1]';

  const strategies: Array<Record<string, unknown>> = [];
  if (proxy && !isLoopback) {
    strategies.push({ dispatcher: agentFor(proxy) });
    // Неидемпотентный POST не должен уйти вторым каналом после потери ответа.
    if (retryOnNetworkError) strategies.push({});
  } else {
    strategies.push({});
  }

  let lastErr: unknown = null;
  for (const extra of strategies) {
    const timeout = timeoutMs === null ? null : AbortSignal.timeout(timeoutMs);
    const composed =
      timeout && signal ? AbortSignal.any([timeout, signal]) : (timeout ?? signal ?? null);
    try {
      return await fetch(url, { ...rest, ...extra, signal: composed } as RequestInit);
    } catch (err) {
      // Клиентский abort — сознательная отмена, фолбэк не нужен.
      if (signal?.aborted) throw err;
      lastErr = err;
    }
  }

  const cause = lastErr instanceof Error ? lastErr.message : String(lastErr);
  const proxied = proxy && !isLoopback;
  const via =
    strategies.length > 1
      ? 'прокси и прямое подключение'
      : proxied
        ? 'только прокси (без повтора)'
        : 'прямое подключение';
  const hint = proxied ? 'Проверьте интернет и локальный прокси (HTTPS_PROXY)' : 'Проверьте интернет';
  throw new Error(`${label ?? 'внешний сервис'}: сеть недоступна (${via}). ${hint}. Причина: ${cause}`);
}
