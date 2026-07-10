// День 30. Локальная LLM как приватный сервис (HTTP-gateway на loopback).
//
// Цель: поднять тонкий OpenAI-compat gateway поверх локального бэкенда
// (LOCAL_LLM_BASE_URL — vLLM/Ollama/LM Studio) с политиками доступа:
// Bearer-auth, rate-limit (RPS token-bucket + TPM sliding-60s), concurrency-семaфор
// с FIFO-очередью и fail-fast 503, max-context-tokens cap. Bind — только 127.0.0.1.
//
// run() = старт → self-test (H/A/X/R/C/S) → таблица фактов → остановка и exit 0.
// Сервер ОБЯЗАТЕЛЬНО закрывается в finally (иначе demo висит на listen). Все fetch
// (self-test + upstream proxy) — с AbortController+timeout.
//
// Бэкенд-доступ — ПРЯМОЙ fetch к ${LOCAL_LLM_BASE_URL}/chat/completions (pass-through
// тела, forced stream:false), НЕ через makeLocalLlmClient()/OllamaNativeClient
// (его /api/chat неработоспособен с vLLM). Зонд — GET ${baseUrl}/models.
//
// НЕТ новых deps: только node:http + нативный fetch. Паттерны HTTP-обработки
// (readBody/isAuthorized/isOriginAllowed/setCors/listen+SIGINT) скопированы из
// mcpHttpServer.ts — НЕ наследуются, mcpHttpServer.ts не трогается.
//
// ── Productionization (вне этого файла, вне репо) ──────────────────────────────
// 3 слоя:
//  (1) BACKEND (вне репо): vLLM на VPS — `vllm serve <model> --port 8000 --api-key`
//      → LOCAL_LLM_BASE_URL=http://vps:8000/v1. Сортинг по железу:
//        1×A100 80GB FP16 → ~100 concurrent; 1×4090 24GB AWQ → ~60–80 concurrent.
//      Ollama — только dev/RAG (дни 21–29), НЕ под concurrency-нагрузку.
//  (2) GATEWAY (этот файл): политики + bind 127.0.0.1. На проде — behind edge.
//  (3) PUBLIC EDGE (вне репо): reverse-proxy nginx/Caddy терминирует TLS,
//      добавляет внешний auth (OAuth/mTLS), limit_req, observability.
// Вне репо остаются: multi-node LB, distributed rate-limit (Redis), HA-failover,
// observability (Prometheus/OpenTelemetry), tiktoken-точный подсчёт токенов.
// Запуск:
//   pnpm --filter challenge start -- day-30

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import {
  getLocalLlmConfig,
  getPrivateLlmServiceConfig,
} from '../core/env.js';
import type { Demo } from './types.js';

const DEFAULT_UPSTREAM_TIMEOUT_MS = 30_000;
const UPSTREAM_PROBE_TIMEOUT_MS = 1_500;
const QUEUE_FACTOR = 2;

// --- Типы ----------------------------------------------------------------

type HealthStatus = 'ok' | 'degraded' | 'down';

interface Upstream {
  baseUrl: string; // напр. http://localhost:11434/v1
  origin: string; // напр. http://localhost:11434
  apiKey: string;
  model: string;
}

interface ServiceConfig {
  port: number;
  authToken?: string;
  rateRps: number;
  rateTpm: number;
  maxConcurrency: number;
  maxQueue: number;
  maxContextTokens: number;
}

interface RateDecision {
  allowed: boolean;
  retryAfterSec: number;
  reason: 'ok' | 'rps' | 'tpm';
}

interface ServiceState {
  startedAt: number;
  limiter: RateLimiter;
  semaphore: ConcurrencySemaphore;
  lastError: { status: number; ts: number } | null;
}

/** HTTP-error с опциональными headers (Retry-After/WWW-Authenticate) и details. */
class HttpError extends Error {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly details?: Record<string, unknown>;
  constructor(
    status: number,
    message: string,
    headers: Record<string, string> = {},
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.headers = headers;
    this.details = details;
  }
}

interface TestResult {
  id: string;
  name: string;
  status: 'pass' | 'skip' | 'fail';
  detail: string;
}

// --- RateLimiter: RPS token-bucket (pre-check) + TPM sliding-60s -----------

class RateLimiter {
  private tokens: number;
  private lastRefillTs: number;
  private readonly tpmWindows: Array<{ ts: number; tokens: number }> = [];
  private tpmUsed = 0;

  constructor(private readonly rps: number, private readonly tpm: number) {
    this.tokens = rps;
    this.lastRefillTs = Date.now();
  }

  private gc(): void {
    const now = Date.now();
    while (this.tpmWindows.length > 0 && now - this.tpmWindows[0]!.ts >= 60_000) {
      this.tpmUsed -= this.tpmWindows.shift()!.tokens;
    }
  }

  check(): RateDecision {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefillTs) / 1000;
    this.tokens = Math.min(this.rps, this.tokens + elapsedSec * this.rps);
    this.lastRefillTs = now;
    this.gc();

    if (this.tpmUsed >= this.tpm) {
      const oldest = this.tpmWindows[0];
      const retryAfter = oldest
        ? Math.max(1, Math.ceil((60_000 - (now - oldest.ts)) / 1000))
        : 1;
      return { allowed: false, retryAfterSec: retryAfter, reason: 'tpm' };
    }
    if (this.tokens < 1) {
      const retryAfter = Math.max(1, Math.ceil((1 - this.tokens) / this.rps));
      return { allowed: false, retryAfterSec: retryAfter, reason: 'rps' };
    }
    this.tokens -= 1;
    return { allowed: true, retryAfterSec: 0, reason: 'ok' };
  }

  accountCompletion(completionTokens: number): void {
    if (completionTokens <= 0) return;
    this.tpmWindows.push({ ts: Date.now(), tokens: completionTokens });
    this.tpmUsed += completionTokens;
  }

  /** Сброс состояния — для изоляции HTTP-тестов self-test друг от друга. */
  reset(): void {
    this.tokens = this.rps;
    this.lastRefillTs = Date.now();
    this.tpmWindows.length = 0;
    this.tpmUsed = 0;
  }

  snapshot(): { rpsTokens: number; rpsCap: number; tpmUsed: number; tpmCap: number } {
    this.gc();
    return {
      rpsTokens: Math.round(this.tokens),
      rpsCap: this.rps,
      tpmUsed: this.tpmUsed,
      tpmCap: this.tpm,
    };
  }
}

// --- ConcurrencySemaphore: FIFO-очередь + fail-fast 503 -------------------

class ConcurrencySemaphore {
  private active = 0;
  private readonly waiters: Array<(release: () => void) => void> = [];

  constructor(private readonly max: number, private readonly maxQueue: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return this.makeRelease();
    }
    if (this.waiters.length >= this.maxQueue) {
      throw new HttpError(503, 'Concurrency queue full', { 'Retry-After': '1' });
    }
    return new Promise<() => void>((resolve) => {
      // Handoff: active не меняется (один holder сменяет другого в очереди).
      this.waiters.push((release) => resolve(release));
    });
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.releaseOne();
    };
  }

  private releaseOne(): void {
    const next = this.waiters.shift();
    if (next) {
      next(this.makeRelease());
      return;
    }
    this.active--;
  }

  snapshot(): { active: number; max: number; queue: number; maxQueue: number } {
    return { active: this.active, max: this.max, queue: this.waiters.length, maxQueue: this.maxQueue };
  }
}

// --- Helpers (паттерны из mcpHttpServer.ts + max-ctx approximation) --------

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function isAuthorized(req: IncomingMessage, authToken: string): boolean {
  const auth = req.headers.authorization;
  if (typeof auth !== 'string') return false;
  return auth === `Bearer ${authToken}`;
}

function isOriginAllowed(origin: string): boolean {
  if (!origin) return false;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function setCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
  if (isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

/** Суммарная оценка prompt-токенов: utf8-bytes/4 (bytes-based точнее для кириллицы). Без tiktoken. */
function approxPromptTokens(messages: unknown[]): number {
  let bytes = 0;
  for (const msg of messages) {
    const c = msg && typeof msg === 'object' ? (msg as { content?: unknown }).content : undefined;
    if (typeof c === 'string') {
      bytes += Buffer.byteLength(c, 'utf8');
    } else if (Array.isArray(c)) {
      for (const part of c) {
        if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
          bytes += Buffer.byteLength((part as { text: string }).text, 'utf8');
        }
      }
    }
  }
  return Math.ceil(bytes / 4);
}

function truncate(s: string, max = 80): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max) + '…' : clean;
}

// --- Зонд upstream: GET ${baseUrl}/models (универсален для OpenAI-compat) ---

async function probeUpstream(
  upstream: Upstream,
): Promise<{ status: HealthStatus; modelLoaded: boolean; reason?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_PROBE_TIMEOUT_MS);
  try {
    const resp = await fetch(`${upstream.baseUrl}/models`, {
      headers: upstream.apiKey ? { Authorization: `Bearer ${upstream.apiKey}` } : {},
      signal: controller.signal,
    });
    if (!resp.ok) {
      return { status: 'degraded', modelLoaded: false, reason: `upstream ${resp.status}` };
    }
    const data = (await resp.json()) as { data?: unknown };
    const list = Array.isArray(data.data) ? data.data : [];
    const ids: string[] = [];
    for (const m of list) {
      if (m && typeof m === 'object' && typeof (m as { id?: unknown }).id === 'string') {
        ids.push((m as { id: string }).id);
      }
    }
    const modelLoaded = upstream.model.length > 0 && ids.includes(upstream.model);
    return {
      status: modelLoaded ? 'ok' : 'degraded',
      modelLoaded,
      reason: modelLoaded ? undefined : `model "${upstream.model}" not in /models`,
    };
  } catch {
    // Sanitized: без body/URL/apiKey — только факт «недоступен».
    return { status: 'down', modelLoaded: false, reason: 'upstream unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

// --- Handlers -------------------------------------------------------------

async function handleHealth(
  res: ServerResponse,
  upstream: Upstream,
  state: ServiceState,
): Promise<void> {
  const probe = await probeUpstream(upstream);
  const snap = state.limiter.snapshot();
  const sem = state.semaphore.snapshot();
  const body: Record<string, unknown> = {
    status: probe.status,
    modelLoaded: probe.modelLoaded,
    upstreamModel: upstream.model,
    uptimeSec: Math.round((Date.now() - state.startedAt) / 1000),
    active: sem.active,
    maxConcurrency: sem.max,
    queue: sem.queue,
    maxQueue: sem.maxQueue,
    rps: { available: snap.rpsTokens, cap: snap.rpsCap },
    tpm: { used: snap.tpmUsed, cap: snap.tpmCap },
    lastError: state.lastError,
  };
  if (probe.reason) body.reason = probe.reason;
  sendJson(res, probe.status === 'down' ? 503 : 200, body);
}

async function handleChat(
  req: IncomingMessage,
  res: ServerResponse,
  upstream: Upstream,
  cfg: ServiceConfig,
  state: ServiceState,
): Promise<void> {
  // 1. auth (если задан authToken).
  if (cfg.authToken !== undefined && !isAuthorized(req, cfg.authToken)) {
    throw new HttpError(401, 'Unauthorized', { 'WWW-Authenticate': 'Bearer realm="private-llm"' });
  }
  // 2. rate-limit (pre-check RPS+TPM).
  const decision = state.limiter.check();
  if (!decision.allowed) {
    throw new HttpError(429, `Rate limit exceeded (${decision.reason})`, {
      'Retry-After': String(decision.retryAfterSec),
    });
  }
  // 3. readBody.
  const raw = await readBody(req);
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw.toString('utf-8'));
    payload = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
  // 4. max-ctx cap.
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const approxTokens = approxPromptTokens(messages as unknown[]);
  if (cfg.maxContextTokens > 0 && approxTokens > cfg.maxContextTokens) {
    throw new HttpError(413, 'Context too large', {}, { maxCtx: cfg.maxContextTokens, approxTokens });
  }
  // 5. semaphore (503 при переполнении очереди).
  const release = await state.semaphore.acquire();
  // 6. proxy к upstream (pass-through, forced stream:false).
  // Один AbortController на upstream-запрос: abort по ИЛИ из {client-close, timeout}
  // (план §2.7 шаг 6). Без client-close propagation обрыв клиента не рвёт upstream-fetch,
  // слот semaphore висит до timeout → очередь переполняется (валидация, причина #2).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_UPSTREAM_TIMEOUT_MS);
  let clientClosed = false;
  const onClientClose = (): void => {
    // Только если ответ ещё не отправлен (нормальное закрытие обмена после sendJson
    // игнорируем — там writableEnded=true).
    if (!res.writableEnded) {
      clientClosed = true;
      controller.abort();
    }
  };
  req.on('close', onClientClose);
  req.on('aborted', onClientClose);
  try {
    const clientModel = typeof payload.model === 'string' ? payload.model : undefined;
    const outBody: Record<string, unknown> = {
      ...payload,
      model: clientModel ?? upstream.model,
      stream: false,
    };
    let upstreamResp: Response;
    try {
      upstreamResp = await fetch(`${upstream.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(upstream.apiKey ? { Authorization: `Bearer ${upstream.apiKey}` } : {}),
        },
        body: JSON.stringify(outBody),
        signal: controller.signal,
      });
    } catch {
      // Abort (client-close | timeout) или network-error → sanitized: без body/URL/apiKey,
      // без stacktrace наружу. Только {status,ts} в lastError.
      if (clientClosed) {
        // Клиент ушёл — ответить некому; sendJson в мёртвый сокет рискнул бы
        // unhandled 'error'. Фиксируем lastError (499=client closed, nginx-convention —
        // отличимо от upstream-ошибок в /healthz) и выходим; finally освободит слот.
        state.lastError = { status: 499, ts: Date.now() };
        return;
      }
      state.lastError = { status: 0, ts: Date.now() };
      throw new HttpError(502, 'Upstream unreachable');
    }
    if (!upstreamResp.ok) {
      const s = upstreamResp.status;
      await upstreamResp.text().catch(() => {}); // drain, не используем body в error.
      state.lastError = { status: s, ts: Date.now() };
      // Sanitized: только status, без body/URL/apiKey (копия client.ts:110-113).
      throw new HttpError(s, `Upstream ${s}`);
    }
    const data: unknown = await upstreamResp.json();
    const usage =
      data && typeof data === 'object' ? (data as { usage?: unknown }).usage : null;
    const completionTokens =
      usage && typeof usage === 'object' && typeof (usage as { completion_tokens?: unknown }).completion_tokens === 'number'
        ? (usage as { completion_tokens: number }).completion_tokens
        : 0;
    state.limiter.accountCompletion(completionTokens);
    sendJson(res, 200, data);
  } finally {
    clearTimeout(timer);
    req.off('close', onClientClose);
    req.off('aborted', onClientClose);
    release();
  }
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  upstream: Upstream,
  cfg: ServiceConfig,
  state: ServiceState,
): Promise<void> {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  const url = req.url ?? '';
  try {
    if (req.method === 'GET' && url === '/healthz') {
      await handleHealth(res, upstream, state);
      return;
    }
    if (req.method === 'POST' && url === '/v1/chat/completions') {
      await handleChat(req, res, upstream, cfg, state);
      return;
    }
    sendJson(res, 404, { error: 'Not found', path: url });
  } catch (err) {
    if (err instanceof HttpError) {
      sendJson(res, err.status, { error: err.message, ...(err.details ?? {}) }, err.headers);
    } else {
      state.lastError = { status: 500, ts: Date.now() };
      sendJson(res, 500, { error: 'Internal error' });
    }
  }
}

// --- Service lifecycle ----------------------------------------------------

function startService(
  upstream: Upstream,
  cfg: ServiceConfig,
): { server: Server; state: ServiceState; close: () => Promise<void> } {
  const state: ServiceState = {
    startedAt: Date.now(),
    limiter: new RateLimiter(cfg.rateRps, cfg.rateTpm),
    semaphore: new ConcurrencySemaphore(cfg.maxConcurrency, cfg.maxQueue),
    lastError: null,
  };
  const server = createServer((req, res) => {
    void handleRequest(req, res, upstream, cfg, state);
  });
  return {
    server,
    state,
    close: async (): Promise<void> => {
      await new Promise<void>((resolve) => {
        // closeAllConnections рвёт keep-alive — иначе demo может висеть на undici-pool.
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        server.close(() => resolve());
      });
    },
  };
}

// --- Self-test ------------------------------------------------------------

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/** fetch, не бросающий: network-error/timeout → null. */
async function safeFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response | null> {
  try {
    return await fetchWithTimeout(url, init, timeoutMs);
  } catch {
    return null;
  }
}

async function runSelfTest(
  base: string,
  cfg: ServiceConfig,
  state: ServiceState,
  upstream: Upstream,
  upstreamUp: boolean,
): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const authHeaders: Record<string, string> = cfg.authToken
    ? { Authorization: `Bearer ${cfg.authToken}` }
    : {};

  // H — health (200 ok/degraded или 503 down; без auth, без секретов).
  {
    const r = await safeFetch(`${base}/healthz`, { method: 'GET' }, 2_000);
    if (!r) {
      results.push({ id: 'H', name: 'health', status: 'fail', detail: 'no response' });
    } else {
      const body = (await r.json().catch(() => ({}))) as { status?: string };
      const ok = r.status === 200 || r.status === 503;
      results.push({
        id: 'H',
        name: 'health',
        status: ok ? 'pass' : 'fail',
        detail: `HTTP ${r.status} · health=${body.status ?? '?'}`,
      });
    }
  }

  // A — auth: без Bearer → 401 + WWW-Authenticate. SKIP если токен не задан.
  if (!cfg.authToken) {
    results.push({ id: 'A', name: 'auth', status: 'skip', detail: 'no authToken (open mode)' });
  } else {
    const r = await safeFetch(
      `${base}/v1/chat/completions`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      2_000,
    );
    if (!r) {
      results.push({ id: 'A', name: 'auth', status: 'fail', detail: 'no response' });
    } else {
      const www = r.headers.get('www-authenticate');
      results.push({
        id: 'A',
        name: 'auth',
        status: r.status === 401 && www != null ? 'pass' : 'fail',
        detail: `HTTP ${r.status} · WWW-Authenticate=${www != null}`,
      });
    }
  }

  // X — max-ctx: messages > cap → 413 + {maxCtx, approxTokens}.
  {
    state.limiter.reset();
    const big = 'а'.repeat(20_000); // 40k utf8-bytes → ~10k approxTokens > 3500 cap.
    const r = await safeFetch(
      `${base}/v1/chat/completions`,
      {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: upstream.model, messages: [{ role: 'user', content: big }] }),
      },
      2_000,
    );
    if (!r) {
      results.push({ id: 'X', name: 'max-ctx', status: 'fail', detail: 'no response' });
    } else {
      const body = (await r.json().catch(() => ({}))) as { approxTokens?: number; maxCtx?: number };
      results.push({
        id: 'X',
        name: 'max-ctx',
        status: r.status === 413 ? 'pass' : 'fail',
        detail: `HTTP ${r.status} · approxTokens=${body.approxTokens ?? '?'}/${body.maxCtx ?? '?'}`,
      });
    }
  }

  // R — rate-limit: burst(rateRps+2) → ≥1×429 + Retry-After.
  {
    state.limiter.reset();
    const burst = cfg.rateRps + 2;
    const statuses = await Promise.all(
      Array.from({ length: burst }, () =>
        safeFetch(
          `${base}/v1/chat/completions`,
          {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: upstream.model, messages: [{ role: 'user', content: 'hi' }] }),
          },
          3_000,
        ).then((r) => (r ? r.status : -1)),
      ),
    );
    const n429 = statuses.filter((s) => s === 429).length;
    const uniq = [...new Set(statuses)].sort().join(',');
    results.push({
      id: 'R',
      name: 'rate-limit',
      status: n429 >= 1 ? 'pass' : 'fail',
      detail: `burst=${burst} · got429=${n429} · statuses=[${uniq}]`,
    });
  }

  // C — chat: 200 + choices[0].message.content + usage. SKIP если upstream down.
  if (!upstreamUp) {
    results.push({ id: 'C', name: 'chat', status: 'skip', detail: 'upstream down' });
  } else {
    state.limiter.reset();
    const r = await safeFetch(
      `${base}/v1/chat/completions`,
      {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: upstream.model,
          messages: [{ role: 'user', content: 'Скажи одно слово: привет' }],
          stream: false,
        }),
      },
      DEFAULT_UPSTREAM_TIMEOUT_MS + 5_000,
    );
    if (!r) {
      results.push({ id: 'C', name: 'chat', status: 'fail', detail: 'no response (timeout?)' });
    } else if (r.status !== 200) {
      results.push({ id: 'C', name: 'chat', status: 'fail', detail: `HTTP ${r.status}` });
    } else {
      const data = (await r.json().catch(() => ({}))) as {
        choices?: Array<{ message?: { content?: unknown } }>;
        usage?: unknown;
      };
      const content = data.choices?.[0]?.message?.content;
      const hasUsage = data.usage != null && typeof data.usage === 'object';
      results.push({
        id: 'C',
        name: 'chat',
        status: typeof content === 'string' && content.length > 0 ? 'pass' : 'fail',
        detail: `content=${typeof content === 'string' ? `"${truncate(content)}"` : '?'} · usage=${hasUsage}`,
      });
    }
  }

  // S — semaphore: in-process проверка queue-full → 503 (детерминирована, без
  // upstream-латентности и без interference с rate-limit). План §2.9 предлагал
  // HTTP-burst, но rate-limit стоит раньше семафора в pipeline → HTTP-burst
  // нельзя заполнить только семафором. Отклонение зафиксировано в fix-report.
  {
    const sem = new ConcurrencySemaphore(cfg.maxConcurrency, cfg.maxQueue);
    let got503 = false;
    let unexpected: string | null = null;
    try {
      const held: Array<() => void> = [];
      for (let i = 0; i < cfg.maxConcurrency; i++) held.push(await sem.acquire());
      const waiters: Promise<() => void>[] = [];
      for (let i = 0; i < cfg.maxQueue; i++) waiters.push(sem.acquire());
      try {
        await sem.acquire(); // (maxConc + maxQueue + 1)-й → должен дать 503.
      } catch (e) {
        if (e instanceof HttpError && e.status === 503) got503 = true;
      }
      // Дренаж: освобождаем held → каскадно разрешаем waiters по порядку.
      for (const rel of held) rel();
      for (const w of waiters) {
        const rel = await w;
        rel();
      }
    } catch (e) {
      unexpected = e instanceof Error ? e.message : String(e);
    }
    results.push(
      unexpected != null
        ? {
            id: 'S',
            name: 'semaphore',
            status: 'fail',
            detail: `unexpected: ${unexpected}`,
          }
        : {
            id: 'S',
            name: 'semaphore',
            status: got503 ? 'pass' : 'fail',
            detail: `maxConc=${cfg.maxConcurrency} · maxQueue=${cfg.maxQueue} · overflow→503=${got503}`,
          },
    );
  }

  return results;
}

function printFactsTable(results: TestResult[], meta: { upstreamUp: boolean; probeStatus: HealthStatus }): void {
  console.log(`${'='.repeat(72)}`);
  console.log('Self-test: политики приватного LLM-gateway');
  console.log('='.repeat(72));
  console.log(`  upstream: ${meta.upstreamUp ? `up (${meta.probeStatus})` : 'down → demo-режим'}`);
  console.log('');
  console.log('  # | check       | рез.  | детали');
  console.log('  --|-------------|-------|-------------------------------------------');
  for (const r of results) {
    const tag = r.status === 'pass' ? 'PASS' : r.status === 'skip' ? 'SKIP' : 'FAIL';
    console.log(`  ${r.id} | ${r.name.padEnd(11)} | ${tag.padEnd(5)} | ${r.detail}`);
  }
  const passed = results.filter((r) => r.status === 'pass').length;
  const skipped = results.filter((r) => r.status === 'skip').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  console.log('');
  console.log(`  итог: ${passed} PASS · ${skipped} SKIP · ${failed} FAIL`);
}

async function run(): Promise<void> {
  console.log('▶ День 30: локальная LLM как приватный сервис (gateway 127.0.0.1)');

  const cfg = getPrivateLlmServiceConfig();
  const serviceCfg: ServiceConfig = { ...cfg, maxQueue: cfg.maxConcurrency * QUEUE_FACTOR };

  let upstream: Upstream;
  let upstreamConfigured: boolean;
  try {
    const local = getLocalLlmConfig();
    upstream = {
      baseUrl: local.baseUrl,
      origin: new URL(local.baseUrl).origin,
      apiKey: local.apiKey,
      model: local.model,
    };
    upstreamConfigured = true;
  } catch {
    upstream = { baseUrl: '', origin: '', apiKey: '', model: '(not configured)' };
    upstreamConfigured = false;
    console.log('  backend:  не настроен (LOCAL_LLM_BASE_URL/MODEL) → demo-режим.');
  }

  console.log(`  bind:     http://127.0.0.1:${serviceCfg.port}`);
  console.log(`  upstream: ${upstreamConfigured ? upstream.baseUrl : '(нет)'}`);
  console.log(`  model:    ${upstream.model}`);
  console.log(`  auth:     ${cfg.authToken ? 'Bearer (PRIVATE_LLM_AUTH_TOKEN)' : 'off — открытый режим'}`);
  console.log(
    `  limits:   rps=${cfg.rateRps} · tpm=${cfg.rateTpm} · concurrency=${cfg.maxConcurrency}+queue=${serviceCfg.maxQueue} · maxCtx=${cfg.maxContextTokens} tok`,
  );
  console.log('');

  const { server, state, close } = startService(upstream, serviceCfg);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      // Только loopback: gateway не светится на внешних интерфейсах.
      server.listen(serviceCfg.port, '127.0.0.1', () => resolve());
    });
  } catch (e) {
    console.error(
      `  Не удалось занять порт ${serviceCfg.port}: ${e instanceof Error ? e.message : e}`,
    );
    console.error('  (PRIVATE_LLM_PORT занят? задайте другой через .env.)');
    await close();
    return;
  }

  try {
    let probeStatus: HealthStatus = 'down';
    let upstreamUp = false;
    if (upstreamConfigured) {
      const probe = await probeUpstream(upstream);
      probeStatus = probe.status;
      upstreamUp = probe.status !== 'down';
      console.log(
        `  probe:    ${probe.status}${probe.modelLoaded ? ' · modelLoaded=true' : ''}${probe.reason ? ` · ${probe.reason}` : ''}`,
      );
      console.log('');
    }

    const base = `http://127.0.0.1:${serviceCfg.port}`;
    const results = await runSelfTest(base, serviceCfg, state, upstream, upstreamUp);
    printFactsTable(results, { upstreamUp, probeStatus });

    console.log(`\n${'='.repeat(72)}`);
    console.log('Готово: день 30. Сервер остановлен, exit 0.');
  } finally {
    await close();
  }
}

export const demo: Demo = {
  id: 'day-30',
  title: 'Локальная LLM как приватный сервис (gateway: auth, rate-limit, concurrency, max-ctx)',
  run,
};
