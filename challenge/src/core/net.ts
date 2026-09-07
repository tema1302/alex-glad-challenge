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
}

export async function netFetch(url: string, init: NetFetchInit = {}): Promise<Response> {
  const { label, timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...rest } = init;
  const proxy = getHttpsProxy();

  const strategies: Array<Record<string, unknown>> = [];
  if (proxy) strategies.push({ dispatcher: agentFor(proxy) });
  strategies.push({});

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
  const via = proxy ? 'прокси и прямое подключение' : 'прямое подключение';
  const hint = proxy ? 'Проверьте интернет и локальный прокси (HTTPS_PROXY)' : 'Проверьте интернет';
  throw new Error(`${label ?? 'внешний сервис'}: сеть недоступна (${via}). ${hint}. Причина: ${cause}`);
}
