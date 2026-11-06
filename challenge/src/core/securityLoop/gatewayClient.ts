// HTTP-клиент LLM Gateway для execution loop (ADVANCED day-14).
//
// Loop не имеет доступа к провайдеру/ключу: единственный путь — POST на
// gateway /v1/chat/completions. Клиент различает allow/masked/redacted и
// типизированные block-ответы (422 input, 200 content_filter output), чтобы
// loop мог записать в лог, что именно поймал gateway.

import { netFetch } from '../net.js';
import type { ChatMessage } from '../types.js';
import type {
  GatewayCallInfo,
  GatewayDirection,
  GatewayFinding,
  LlmCallOptions,
  LlmCaller,
  LlmResult,
} from './types.js';

export type GatewayFetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface GatewayClientOptions {
  readonly baseUrl: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly fetchFn?: GatewayFetchFn;
}

/** Gateway недоступен/вернул не-2xx, которую loop не умеет трактовать. */
export class GatewayHttpError extends Error {
  readonly status: number;
  readonly requestId: string | null;

  constructor(status: number, requestId: string | null) {
    super(`LLM Gateway HTTP ${status || 'network'}`);
    this.name = 'GatewayHttpError';
    this.status = status;
    this.requestId = requestId;
  }
}

/** Input/Output Guard заблокировал вызов. Findings уже безопасны (preview). */
export class GatewayBlockedError extends Error {
  readonly direction: GatewayDirection;
  readonly status: number;
  readonly findings: readonly GatewayFinding[];
  readonly warning: string | null;
  readonly requestId: string | null;
  readonly costUsd: number | null;

  constructor(
    direction: GatewayDirection,
    status: number,
    findings: readonly GatewayFinding[],
    warning: string | null,
    requestId: string | null,
    costUsd: number | null,
  ) {
    super(`LLM Gateway blocked ${direction}`);
    this.name = 'GatewayBlockedError';
    this.direction = direction;
    this.status = status;
    this.findings = findings;
    this.warning = warning;
    this.requestId = requestId;
    this.costUsd = costUsd;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeFindings(value: unknown): GatewayFinding[] {
  const out: GatewayFinding[] = [];
  for (const item of asArray(value).slice(0, 20)) {
    const rec = asRecord(item);
    if (!rec) continue;
    const kind = asString(rec.kind) ?? 'unknown';
    const severity = asString(rec.severity) ?? 'unknown';
    const preview = asString(rec.preview) ?? '';
    const via = asString(rec.via);
    out.push({ kind, severity, preview, ...(via ? { via } : {}) });
  }
  return out;
}

/** Gateway из Day 13 — loopback-only; не отправляем промпты на внешний хост. */
export function assertLoopbackGatewayUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RangeError('invalid gateway URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new RangeError('gateway URL must be http(s)');
  }
  const host = url.hostname.toLowerCase();
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    throw new RangeError('gateway URL must be loopback (127.0.0.1/localhost/::1)');
  }
  if (url.username || url.password) {
    throw new RangeError('gateway URL must not contain credentials');
  }
  return raw;
}

export class GatewayClient implements LlmCaller {
  private readonly baseUrl: string;
  private readonly model: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchFn: GatewayFetchFn;

  constructor(opts: GatewayClientOptions) {
    this.baseUrl = assertLoopbackGatewayUrl(opts.baseUrl).replace(/\/+$/, '');
    this.model = opts.model?.trim() || undefined;
    this.timeoutMs = opts.timeoutMs ?? 180_000;
    this.fetchFn = opts.fetchFn ?? defaultGatewayFetch(this.timeoutMs);
  }

  async chat(messages: readonly ChatMessage[], opts: LlmCallOptions = {}): Promise<LlmResult> {
    const stage = opts.stage ?? 'generation';
    const model = opts.model?.trim() || this.model;
    const body: Record<string, unknown> = {
      messages,
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 1600,
      ...(model ? { model } : {}),
    };

    let resp: Response;
    try {
      resp = await this.fetchFn(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      // Сырое сетевое сообщение может содержать URL/прокси; наружу — только статус.
      throw new GatewayHttpError(0, null);
    }

    const parsed: unknown = await resp.json().catch(() => null);
    const root = asRecord(parsed);
    const gateway = asRecord(root?.gateway);
    const guard = asRecord(gateway?.guard);
    const requestId =
      resp.headers.get('x-request-id') ??
      asString(root?.id) ??
      asString(gateway?.requestId);
    const headerCostRaw = resp.headers.get('x-gateway-cost-usd');
    const headerCost = headerCostRaw === null ? Number.NaN : Number(headerCostRaw);
    const costUsd =
      asNumber(gateway?.costUsd) ??
      (Number.isFinite(headerCost) ? headerCost : null);
    const warning = asString(gateway?.warning);

    if (!resp.ok) {
      const findings = normalizeFindings(root?.findings);
      const guardName = asString(root?.guard);
      if (resp.status === 422 && guardName === 'input') {
        throw new GatewayBlockedError(
          'input',
          resp.status,
          findings,
          asString(root?.error) ?? warning,
          requestId,
          costUsd,
        );
      }
      throw new GatewayHttpError(resp.status, requestId);
    }

    const choice = asRecord(asArray(root?.choices)[0]);
    const message = asRecord(choice?.message);
    const content = asString(message?.content) ?? '';
    const outputGuard =
      guard?.output === 'blocked'
        ? 'blocked'
        : guard?.output === 'redacted'
          ? 'redacted'
          : 'allow';
    const inputGuard = guard?.input === 'masked' ? 'masked' : 'allow';

    if (outputGuard === 'blocked' || choice?.finish_reason === 'content_filter') {
      throw new GatewayBlockedError(
        'output',
        resp.status,
        normalizeFindings(root?.outputFindings),
        warning,
        requestId,
        costUsd,
      );
    }

    if (!content.trim()) {
      throw new GatewayHttpError(502, requestId);
    }

    const info: GatewayCallInfo = {
      stage,
      requestId,
      input: inputGuard,
      output: outputGuard,
      warning,
      costUsd,
    };
    return { content, info };
  }
}

function defaultGatewayFetch(timeoutMs: number): GatewayFetchFn {
  return (url, init = {}) => {
    const { signal, ...rest } = init;
    return netFetch(url, {
      ...rest,
      signal: signal ?? undefined,
      label: 'LLM gateway',
      timeoutMs,
    });
  };
}
