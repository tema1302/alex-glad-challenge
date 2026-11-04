import test from 'node:test';
import assert from 'node:assert/strict';

import { IpRateLimiter } from './rateLimit.js';

test('IpRateLimiter: пропускает N запросов и блокирует N+1', () => {
  let now = 0;
  const limiter = new IpRateLimiter(3, 60_000, () => now);
  assert.equal(limiter.check('1.1.1.1').allowed, true);
  assert.equal(limiter.check('1.1.1.1').allowed, true);
  const third = limiter.check('1.1.1.1');
  assert.equal(third.allowed, true);
  assert.equal(third.remaining, 0);
  const fourth = limiter.check('1.1.1.1');
  assert.equal(fourth.allowed, false);
  assert.equal(fourth.retryAfterSec, 60);
});

test('IpRateLimiter: окно скользит и лимит восстанавливается', () => {
  let now = 0;
  const limiter = new IpRateLimiter(2, 60_000, () => now);
  limiter.check('ip');
  limiter.check('ip');
  assert.equal(limiter.check('ip').allowed, false);
  now += 60_001;
  assert.equal(limiter.check('ip').allowed, true);
});

test('IpRateLimiter: IP независимы', () => {
  let now = 0;
  const limiter = new IpRateLimiter(1, 60_000, () => now);
  assert.equal(limiter.check('a').allowed, true);
  assert.equal(limiter.check('a').allowed, false);
  assert.equal(limiter.check('b').allowed, true);
});
