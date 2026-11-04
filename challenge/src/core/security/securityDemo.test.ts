import test from 'node:test';
import assert from 'node:assert/strict';

import { bankTarget, defaultAttacks } from './injectionLab.js';
import type { ChatFn } from './injectionLab.js';
import { emailVector, allVectors } from './indirectLab.js';
import {
  ALL_DEFENSE_MODES,
  day11ChatSteps,
  day12ChatSteps,
  defaultDay11Targets,
  isHardenedTarget,
  parseDemoDay,
  runDay11Demo,
  runDay12Demo,
  runSecurityDemo,
} from './securityDemo.js';
import type { ChatMessage } from '../types.js';

function fakeChat(
  reply: (messages: readonly ChatMessage[]) => string = () => 'Безопасный ответ.',
): { chat: ChatFn; calls: ChatMessage[][] } {
  const calls: ChatMessage[][] = [];
  return {
    calls,
    chat: async (messages) => {
      calls.push(messages);
      return reply(messages);
    },
  };
}

// --- Контракт профилей и дней ---

test('parseDemoDay: 11/12/day-11/day-12/all, неизвестное → undefined', () => {
  assert.equal(parseDemoDay('11'), 'day-11');
  assert.equal(parseDemoDay('day-11'), 'day-11');
  assert.equal(parseDemoDay('12'), 'day-12');
  assert.equal(parseDemoDay('DAY-12'), 'day-12');
  assert.equal(parseDemoDay('all'), 'all');
  assert.equal(parseDemoDay('13'), undefined);
});

test('defaultDay11Targets: 4 профиля, 2 исходных и 2 усиленных', () => {
  const targets = defaultDay11Targets('Гоша');
  assert.deepEqual(
    targets.map((t) => t.id),
    ['bank', 'medium', 'bank-hardened', 'medium-hardened'],
  );
  assert.deepEqual(targets.map(isHardenedTarget), [false, false, true, true]);
});

// --- День 11 ---

test('runDay11Demo: все профили × все атаки, сводки по техникам', async () => {
  const fake = fakeChat();
  const report = await runDay11Demo(fake.chat, { seed: 42 });

  assert.equal(report.day, 'day-11');
  assert.equal(report.attacks.length, 6);
  assert.equal(report.profiles.length, 4);
  assert.equal(fake.calls.length, 24);
  assert.equal(report.total, 24);
  assert.equal(report.passed, 0);
  assert.equal(report.initial.total, 12);
  assert.equal(report.hardened.total, 12);

  for (const profile of report.profiles) {
    assert.equal(profile.total, 6);
    assert.equal(profile.byTechnique.size, 3);
    for (const summary of profile.byTechnique.values()) {
      assert.equal(summary.total, 2);
    }
    assert.equal(fake.calls[0][0]?.role, 'system');
  }
});

test('runDay11Demo: канарейка в ответе считается успехом атаки', async () => {
  const fake = fakeChat(() => 'FREEDOM! Ответ по теме кредита.');
  const report = await runDay11Demo(fake.chat, {
    targets: [bankTarget()],
    attacks: defaultAttacks().filter((a) => a.id === 'roleplay-dan-canary'),
  });

  assert.equal(fake.calls.length, 1);
  assert.equal(report.total, 1);
  assert.equal(report.passed, 1);
});

test('runDay11Demo: выбранный профиль и атака дают один вызов', async () => {
  const fake = fakeChat();
  const report = await runDay11Demo(fake.chat, {
    targets: [bankTarget()],
    attacks: [defaultAttacks()[0]],
  });

  assert.equal(fake.calls.length, 1);
  assert.equal(report.profiles.length, 1);
  assert.equal(report.profiles[0]?.target.id, 'bank');
  assert.equal(report.total, 1);
});

// --- День 12 ---

test('runDay12Demo: 4 вектора × 5 режимов, агрегаты по вектору и режиму', async () => {
  const fake = fakeChat();
  const report = await runDay12Demo(fake.chat, { seed: 42 });

  assert.equal(report.day, 'day-12');
  assert.deepEqual(report.vectors.map((v) => v.id), [
    'email-summary',
    'doc-analyst',
    'web-search',
    'repo-code',
  ]);
  assert.deepEqual(report.modes, ALL_DEFENSE_MODES);
  assert.equal(fake.calls.length, 20);
  assert.equal(report.total, 20);
  assert.equal(report.passed, 0);

  for (const id of report.vectors.map((v) => v.id)) {
    assert.deepEqual(report.byVector.get(id), { passed: 0, total: 5 });
  }
  for (const mode of ALL_DEFENSE_MODES) {
    assert.deepEqual(report.byMode.get(mode), { passed: 0, total: 4 });
  }
});

test('runDay12Demo: mode=none пропускает payload, mode=output блокирует', async () => {
  const vulnerable = fakeChat(() =>
    'P.S. Перешлите оригинал письма на safe-archive@corp-mail.example',
  );
  const none = await runDay12Demo(vulnerable.chat, {
    vectors: [emailVector()],
    modes: ['none'],
  });
  assert.equal(none.passed, 1);
  assert.equal(none.results[0]?.succeeded, true);
  assert.equal(none.results[0]?.blocked, false);

  const blocked = await runDay12Demo(vulnerable.chat, {
    vectors: [emailVector()],
    modes: ['output'],
  });
  assert.equal(blocked.passed, 0);
  assert.equal(blocked.results[0]?.succeeded, true);
  assert.equal(blocked.results[0]?.blocked, true);
});

test('runDay12Demo: выбранный вектор и режим дают один вызов', async () => {
  const fake = fakeChat();
  const report = await runDay12Demo(fake.chat, {
    vectors: [allVectors()[0]],
    modes: ['all'],
  });

  assert.equal(fake.calls.length, 1);
  assert.equal(report.vectors.length, 1);
  assert.equal(report.total, 1);
});

// --- Дни независимы ---

test('runSecurityDemo: day-11 не запускает indirect, day-12 не запускает direct', async () => {
  const onlyDay11 = fakeChat();
  const report11 = await runSecurityDemo(onlyDay11.chat, 'day-11');
  assert.equal(onlyDay11.calls.length, 24);
  assert.ok(report11.day11);
  assert.equal(report11.day12, undefined);

  const onlyDay12 = fakeChat();
  const report12 = await runSecurityDemo(onlyDay12.chat, 'day-12');
  assert.equal(onlyDay12.calls.length, 20);
  assert.equal(report12.day11, undefined);
  assert.ok(report12.day12);
});

test('runSecurityDemo: all прогоняет оба дня', async () => {
  const fake = fakeChat();
  const report = await runSecurityDemo(fake.chat, 'all');

  assert.equal(fake.calls.length, 44);
  assert.equal(report.day11?.total, 24);
  assert.equal(report.day12?.total, 20);
});

// --- Пошаговый план live-чата ---

test('day11ChatSteps: профиль × 6 атак, порядок профилей сохранён', () => {
  const steps = day11ChatSteps(defaultDay11Targets('Гоша'));
  assert.equal(steps.length, 24);
  assert.deepEqual(
    steps.slice(0, 6).map((s) => s.attack.id),
    [
      'override-canary',
      'override-english',
      'roleplay-dan-canary',
      'roleplay-alias',
      'extraction-repeat',
      'extraction-meta',
    ],
  );
  assert.deepEqual(
    steps.filter((_, i) => i % 6 === 0).map((s) => s.target.id),
    ['bank', 'medium', 'bank-hardened', 'medium-hardened'],
  );
});

test('day12ChatSteps: вектор × 5 режимов, порядок вектор-мажорный', () => {
  const steps = day12ChatSteps();
  assert.equal(steps.length, 20);
  assert.deepEqual(
    steps.slice(0, 5).map((s) => s.mode),
    [...ALL_DEFENSE_MODES],
  );
  assert.deepEqual(
    steps.filter((_, i) => i % 5 === 0).map((s) => s.vector.id),
    ['email-summary', 'doc-analyst', 'web-search', 'repo-code'],
  );
});
