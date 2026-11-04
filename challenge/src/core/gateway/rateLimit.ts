// Rate limiting для gateway: не больше N запросов в минуту с одного IP.
// Sliding-window по timestamp'ам, часы инжектируются для тестов.

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSec: number;
  readonly resetAt: number;
}

const DEFAULT_WINDOW_MS = 60_000;
const MAX_TRACKED_IPS = 10_000;

export class IpRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(limit: number, windowMs = DEFAULT_WINDOW_MS, now: () => number = Date.now) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new RangeError('rate limit must be a positive integer');
    }
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
      throw new RangeError('windowMs must be a positive number');
    }
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  check(ip: string): RateLimitDecision {
    const at = this.now();
    const cutoff = at - this.windowMs;
    this.prune(cutoff);

    const recent = (this.hits.get(ip) ?? []).filter((ts) => ts > cutoff);
    if (recent.length >= this.limit) {
      const oldest = recent[0] ?? at;
      const resetAt = oldest + this.windowMs;
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec: Math.max(1, Math.ceil((resetAt - at) / 1000)),
        resetAt,
      };
    }

    recent.push(at);
    this.hits.set(ip, recent);
    return {
      allowed: true,
      remaining: Math.max(0, this.limit - recent.length),
      retryAfterSec: 0,
      resetAt: at + this.windowMs,
    };
  }

  reset(): void {
    this.hits.clear();
  }

  private prune(cutoff: number): void {
    if (this.hits.size <= MAX_TRACKED_IPS) return;
    for (const [ip, stamps] of this.hits) {
      if (stamps.length === 0 || stamps[stamps.length - 1]! <= cutoff) {
        this.hits.delete(ip);
      }
    }
  }
}
