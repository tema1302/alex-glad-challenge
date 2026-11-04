// LLM Gateway (ADVANCED day-13): HTTP-прокси между клиентом и провайдером.
//
// Поток: rate limit -> Input Guard -> upstream (OpenAI/Anthropic) ->
// Output Guard -> cost tracking -> audit log -> клиент.
// Секреты никогда не попадают в ответ, audit или intercepted-лог сырыми.

import { randomBytes } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

import type { GatewayConfig, GatewayUpstreamConfig } from '../env.js';
import type { ChatMessage, Usage } from '../types.js';
import { TokenEstimator } from '../tokenEstimator.js';
import { guardInput } from './inputGuard.js';
import { guardOutput, summarizeOutputFindings } from './outputGuard.js';
import { IpRateLimiter } from './rateLimit.js';
import { CostTracker, costForUsage } from './cost.js';
import {
  JsonlAuditLog,
  JsonlInterceptedLog,
  safePreview,
  type AuditFinding,
  type AuditRecord,
  type AuditSink,
  type AuditStatus,
  type InterceptedSink,
} from './auditLog.js';
import { callUpstream, defaultFetch, UpstreamError, type FetchFn } from './upstream.js';

export interface GatewayServerOptions {
  readonly config: GatewayConfig;
  readonly upstream: GatewayUpstreamConfig;
  readonly fetchFn?: FetchFn;
  readonly audit?: AuditSink;
  readonly intercepted?: InterceptedSink;
  readonly now?: () => number;
  readonly logger?: (line: string) => void;
}

export interface GatewayStats {
  readonly requests: number;
  readonly allowed: number;
  readonly masked: number;
  readonly blockedInput: number;
  readonly blockedOutput: number;
  readonly rateLimited: number;
  readonly upstreamErrors: number;
  readonly badRequests: number;
  readonly totalCostUsd: number;
  readonly uptimeSec: number;
}

export interface GatewayHandle {
  readonly server: Server;
  readonly stats: () => GatewayStats;
  readonly close: () => Promise<void>;
}

export interface RunningGateway extends GatewayHandle {
  readonly url: string;
}

interface MutableStats {
  requests: number;
  allowed: number;
  masked: number;
  blockedInput: number;
  blockedOutput: number;
  rateLimited: number;
  upstreamErrors: number;
  badRequests: number;
  totalCostUsd: number;
}

interface Runtime {
  readonly limiter: IpRateLimiter;
  readonly cost: CostTracker;
  readonly stats: MutableStats;
  readonly startedAt: number;
  readonly now: () => number;
}

interface ChatBody {
  readonly messages: ChatMessage[];
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const MAX_AUDIT_PREVIEW = 400;

function newRequestId(now: number): string {
  return `gw_${now.toString(36)}_${randomBytes(4).toString('hex')}`;
}

function sendJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): void {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', Buffer.byteLength(body));
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.end(body);
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        req.removeAllListeners('data');
        req.resume();
        reject(new HttpError(413, 'Request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', (err) => reject(err));
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function validateChatBody(raw: string): ChatBody {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
  const body = asRecord(parsed);
  if (!body) throw new HttpError(400, 'Body must be a JSON object');
  const rawMessages = body.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    throw new HttpError(400, 'messages must be a non-empty array');
  }
  const messages: ChatMessage[] = [];
  for (const item of rawMessages) {
    const m = asRecord(item);
    if (!m) throw new HttpError(400, 'each message must be an object');
    const role = m.role;
    const content = m.content;
    if (role !== 'system' && role !== 'user' && role !== 'assistant') {
      throw new HttpError(400, 'message.role must be system|user|assistant');
    }
    if (typeof content !== 'string' || content.length === 0) {
      throw new HttpError(400, 'message.content must be a non-empty string');
    }
    messages.push({ role, content });
  }
  if (!messages.some((m) => m.role !== 'system')) {
    throw new HttpError(400, 'at least one user/assistant message is required');
  }
  const model = body.model;
  if (model !== undefined && (typeof model !== 'string' || model.trim() === '')) {
    throw new HttpError(400, 'model must be a non-empty string');
  }
  const temperature = body.temperature;
  if (
    temperature !== undefined &&
    (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0 || temperature > 2)
  ) {
    throw new HttpError(400, 'temperature must be a number between 0 and 2');
  }
  const maxTokens = body.max_tokens ?? body.maxTokens;
  if (
    maxTokens !== undefined &&
    (typeof maxTokens !== 'number' || !Number.isInteger(maxTokens) || maxTokens <= 0)
  ) {
    throw new HttpError(400, 'max_tokens must be a positive integer');
  }
  return {
    messages,
    ...(typeof model === 'string' ? { model: model.trim() } : {}),
    ...(typeof temperature === 'number' ? { temperature } : {}),
    ...(typeof maxTokens === 'number' ? { maxTokens } : {}),
  };
}

function estimateUsage(messages: readonly ChatMessage[], content: string): Usage {
  const estimator = new TokenEstimator();
  const prompt = estimator.estimate(messages).total;
  const completion = estimator.estimateText(content).tokens;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
  };
}

function toAuditFindings(
  findings: ReadonlyArray<{ kind: string; severity: string; preview: string; via?: string }>,
): AuditFinding[] {
  return findings.map((f) => ({
    kind: f.kind,
    severity: f.severity,
    preview: f.preview,
    ...(f.via ? { via: f.via } : {}),
  }));
}

function writeIntercepted(
  sink: InterceptedSink,
  ts: string,
  requestId: string,
  direction: 'input' | 'output',
  findings: ReadonlyArray<{ kind: string; severity: string; preview: string; via?: string }>,
): void {
  for (const f of findings) {
    sink.write({
      ts,
      requestId,
      direction,
      kind: f.kind,
      severity: f.severity,
      preview: f.preview,
      ...(f.via ? { via: f.via } : {}),
    });
  }
}

function statsSnapshot(rt: Runtime): GatewayStats {
  return {
    ...rt.stats,
    totalCostUsd: rt.cost.snapshot().totalUsd,
    uptimeSec: Math.max(0, Math.floor((rt.now() - rt.startedAt) / 1000)),
  };
}

async function handleChat(
  req: IncomingMessage,
  res: ServerResponse,
  opts: GatewayServerOptions,
  rt: Runtime,
  audit: AuditSink,
  intercepted: InterceptedSink,
): Promise<void> {
  const startedAt = rt.now();
  const requestId = newRequestId(startedAt);
  const ip = req.socket.remoteAddress ?? 'unknown';
  const auditBase = {
    ts: new Date(startedAt).toISOString(),
    requestId,
    ip,
    provider: opts.upstream.provider,
    model: opts.upstream.model,
  };

  const finish = (record: AuditRecord): void => {
    audit.write(record);
  };

  const sendAudit = (
    status: AuditStatus,
    httpStatus: number,
    payload: unknown,
    extra: Partial<AuditRecord> = {},
    headers: Record<string, string> = {},
  ): void => {
    finish({
      ...auditBase,
      status,
      latencyMs: Math.max(0, rt.now() - startedAt),
      inputFindings: [],
      outputFindings: [],
      promptPreview: '',
      responsePreview: '',
      ...extra,
    });
    sendJson(res, httpStatus, payload, { 'x-request-id': requestId, ...headers });
  };

  rt.stats.requests += 1;

  let raw = '';
  try {
    raw = await readBody(req, opts.config.maxBodyBytes);
  } catch (err) {
    const e = err instanceof HttpError ? err : new HttpError(400, 'Failed to read body');
    rt.stats.badRequests += 1;
    sendAudit('bad_request', e.status, { error: e.message }, { promptPreview: safePreview(raw) });
    return;
  }

  let body: ChatBody;
  try {
    body = validateChatBody(raw);
  } catch (err) {
    const e = err instanceof HttpError ? err : new HttpError(400, 'Invalid request');
    rt.stats.badRequests += 1;
    sendAudit(
      'bad_request',
      e.status,
      { error: e.message },
      { promptPreview: safePreview(raw, MAX_AUDIT_PREVIEW) },
    );
    return;
  }

  const rate = rt.limiter.check(ip);
  if (!rate.allowed) {
    rt.stats.rateLimited += 1;
    sendAudit(
      'rate_limited',
      429,
      { error: 'Rate limit exceeded', retryAfterSec: rate.retryAfterSec },
      { promptPreview: safePreview(body.messages.map((m) => m.content).join('\n')) },
      { 'retry-after': String(rate.retryAfterSec) },
    );
    return;
  }

  const input = guardInput(body.messages, { mode: opts.config.guardMode });
  const inputAudit = toAuditFindings(input.summary);
  const promptPreview = safePreview(body.messages.map((m) => m.content).join('\n'));
  if (input.findings.length > 0) {
    writeIntercepted(intercepted, auditBase.ts, requestId, 'input', input.summary);
  }

  if (input.action === 'blocked') {
    rt.stats.blockedInput += 1;
    sendAudit(
      'blocked_input',
      422,
      { error: input.warning, guard: 'input', findings: input.summary },
      {
        promptPreview,
        inputFindings: inputAudit,
        warning: input.warning ?? undefined,
      },
    );
    return;
  }

  let upstream;
  try {
    upstream = await callUpstream(
      opts.upstream,
      {
        messages: input.messages,
        ...(body.model ? { model: body.model } : {}),
        ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
        ...(body.maxTokens !== undefined ? { maxTokens: body.maxTokens } : {}),
      },
      opts.fetchFn ?? defaultFetch,
    );
  } catch (err) {
    rt.stats.upstreamErrors += 1;
    const upstreamStatus = err instanceof UpstreamError ? err.status : 0;
    opts.logger?.(
      `[gateway] upstream error request=${requestId} status=${upstreamStatus || 'network'}`,
    );
    sendAudit(
      'upstream_error',
      502,
      { error: upstreamStatus ? `Upstream error ${upstreamStatus}` : 'Upstream unreachable' },
      { promptPreview, inputFindings: inputAudit },
    );
    return;
  }

  const systemPrompt = body.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const output = guardOutput(upstream.content, { systemPrompt });
  const outputAudit = toAuditFindings(summarizeOutputFindings(output.findings));
  if (output.findings.length > 0) {
    writeIntercepted(intercepted, auditBase.ts, requestId, 'output', summarizeOutputFindings(output.findings));
  }

  const usage =
    upstream.usage.prompt_tokens || upstream.usage.completion_tokens
      ? upstream.usage
      : estimateUsage(body.messages, output.text);
  const cost = costForUsage(body.model ?? upstream.model, usage);
  rt.cost.add(cost);

  const blocked = output.action === 'blocked';
  if (blocked) rt.stats.blockedOutput += 1;
  else if (input.action === 'masked') rt.stats.masked += 1;
  else rt.stats.allowed += 1;

  const status: AuditStatus = blocked
    ? 'blocked_output'
    : input.action === 'masked'
      ? 'masked'
      : 'allowed';

  finish({
    ...auditBase,
    model: upstream.model,
    status,
    latencyMs: Math.max(0, rt.now() - startedAt),
    inputFindings: inputAudit,
    outputFindings: outputAudit,
    promptPreview,
    responsePreview: safePreview(upstream.content, MAX_AUDIT_PREVIEW),
    usage,
    costUsd: cost.totalUsd,
    ...(output.warning ? { warning: output.warning } : {}),
  });

  sendJson(
    res,
    200,
    {
      id: requestId,
      object: 'chat.completion',
      created: Math.floor(rt.now() / 1000),
      model: upstream.model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: output.text },
          finish_reason: blocked ? 'content_filter' : 'stop',
        },
      ],
      usage,
      gateway: {
        requestId,
        guard: { input: input.action, output: output.action },
        costUsd: cost.totalUsd,
        warning: output.warning,
      },
    },
    {
      'x-request-id': requestId,
      'x-gateway-guard': `input=${input.action};output=${output.action}`,
      'x-gateway-cost-usd': cost.totalUsd.toFixed(6),
      'x-ratelimit-remaining': String(rate.remaining),
      'cache-control': 'no-store',
    },
  );
}

function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: GatewayServerOptions,
  rt: Runtime,
  audit: AuditSink,
  intercepted: InterceptedSink,
): void {
  const url = req.url ?? '/';
  res.setHeader('cache-control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method === 'GET' && (url === '/healthz' || url === '/health')) {
    sendJson(res, 200, {
      status: 'ok',
      provider: opts.upstream.provider,
      model: opts.upstream.model,
      uptimeSec: statsSnapshot(rt).uptimeSec,
    });
    return;
  }

  if (req.method === 'GET' && url === '/stats') {
    sendJson(res, 200, statsSnapshot(rt));
    return;
  }

  if (!(req.method === 'POST' && (url === '/v1/chat/completions' || url === '/chat/completions'))) {
    sendJson(res, 404, { error: 'Not found', path: url });
    return;
  }

  void handleChat(req, res, opts, rt, audit, intercepted).catch((err: unknown) => {
    opts.logger?.(`[gateway] internal error: ${err instanceof Error ? err.message : 'unknown'}`);
    if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' });
  });
}

export function createGateway(opts: GatewayServerOptions): GatewayHandle {
  const now = opts.now ?? Date.now;
  const rt: Runtime = {
    limiter: new IpRateLimiter(opts.config.rateLimitPerMin, 60_000, now),
    cost: new CostTracker(),
    stats: {
      requests: 0,
      allowed: 0,
      masked: 0,
      blockedInput: 0,
      blockedOutput: 0,
      rateLimited: 0,
      upstreamErrors: 0,
      badRequests: 0,
      totalCostUsd: 0,
    },
    startedAt: now(),
    now,
  };
  const audit = opts.audit ?? new JsonlAuditLog();
  const intercepted = opts.intercepted ?? new JsonlInterceptedLog();
  const server = createServer((req, res) => {
    handleRequest(req, res, opts, rt, audit, intercepted);
  });

  return {
    server,
    stats: () => statsSnapshot(rt),
    close: async (): Promise<void> => {
      await new Promise<void>((resolve) => {
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        server.close(() => resolve());
      });
    },
  };
}

export async function startGateway(
  opts: GatewayServerOptions & { readonly port?: number },
): Promise<RunningGateway> {
  const handle = createGateway(opts);
  const port = opts.port ?? opts.config.port;
  await new Promise<void>((resolve, reject) => {
    handle.server.once('error', reject);
    handle.server.listen(port, opts.config.host, () => {
      handle.server.off('error', reject);
      resolve();
    });
  });
  const address = handle.server.address() as AddressInfo | null;
  const actualPort = address?.port ?? port;
  const host = opts.config.host.includes(':') ? `[${opts.config.host}]` : opts.config.host;
  return { ...handle, url: `http://${host}:${actualPort}` };
}
