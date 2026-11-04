import test from 'node:test';
import assert from 'node:assert/strict';

import { CostTracker, costForUsage, priceForModel } from './cost.js';

test('costForUsage: считает input/output по прайсу модели', () => {
  const cost = costForUsage('deepseek-chat', {
    prompt_tokens: 1_000_000,
    completion_tokens: 1_000_000,
    total_tokens: 2_000_000,
  });
  assert.equal(cost.inputUsd, 0.27);
  assert.equal(cost.outputUsd, 1.1);
  assert.equal(cost.totalUsd, 1.37);
});

test('costForUsage: малые объёмы округляются до 6 знаков', () => {
  const cost = costForUsage('gpt-4o-mini', {
    prompt_tokens: 1000,
    completion_tokens: 500,
    total_tokens: 1500,
  });
  assert.equal(cost.totalUsd, 0.00045);
});

test('priceForModel: longest-prefix и fallback', () => {
  assert.equal(priceForModel('deepseek-chat-v3.1').inputPer1M, 0.27);
  assert.equal(priceForModel('claude-3-5-sonnet-20241022').outputPer1M, 15);
  assert.equal(priceForModel('unknown-model').inputPer1M, 0.5);
});

test('CostTracker: накапливает запросы и стоимость', () => {
  const tracker = new CostTracker();
  tracker.add(costForUsage('deepseek-chat', { prompt_tokens: 1_000_000, completion_tokens: 0, total_tokens: 1_000_000 }));
  tracker.add(costForUsage('deepseek-chat', { prompt_tokens: 0, completion_tokens: 1_000_000, total_tokens: 1_000_000 }));
  assert.equal(tracker.snapshot().requests, 2);
  assert.equal(tracker.snapshot().totalUsd, 1.37);
  assert.equal(tracker.snapshot().inputTokens, 1_000_000);
  assert.equal(tracker.snapshot().outputTokens, 1_000_000);
});
