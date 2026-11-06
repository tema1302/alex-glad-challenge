import test from 'node:test';
import assert from 'node:assert/strict';

import { CommandTestRunner, StaticTestRunner } from './tests.js';
import type { CodeTask } from './types.js';

const task: CodeTask = {
  id: 'test',
  title: 'Test',
  prompt: 'x',
  stack: 'android',
  fileName: 'TokenStore.kt',
  scenario: 'security',
  requiredPatterns: [
    { label: 'class', re: /class\s+\w+/ },
    { label: 'save', re: /fun\s+save\s*\(/ },
    { label: 'load', re: /fun\s+load\s*\(/ },
  ],
};

test('StaticTestRunner: валидный Kotlin проходит', async () => {
  const code = 'class TokenStore {\n  fun save(token: String) {}\n  fun load(): String? = null\n}';
  const result = await new StaticTestRunner().run(code, task);
  assert.equal(result.ok, true);
  assert.ok(result.checks.every((c) => c.ok));
});

test('StaticTestRunner: незакрытая скобка → fail', async () => {
  const result = await new StaticTestRunner().run('class TokenStore {', task);
  assert.equal(result.ok, false);
  assert.ok(result.checks.some((c) => c.name === 'balanced-delimiters' && !c.ok));
});

test('StaticTestRunner: TODO → fail', async () => {
  const code = 'class TokenStore {\n  // TODO: implement\n  fun save(token: String) {}\n  fun load() {}\n}';
  const result = await new StaticTestRunner().run(code, task);
  assert.equal(result.ok, false);
  assert.ok(result.checks.some((c) => c.name === 'no-placeholders' && !c.ok));
});

test('StaticTestRunner: пропущенный контракт → fail с detail', async () => {
  const result = await new StaticTestRunner().run('class TokenStore {}', task);
  assert.equal(result.ok, false);
  const failed = result.checks.find((c) => c.name === 'contract:save');
  assert.equal(failed?.ok, false);
  assert.ok(failed?.detail?.includes('pattern not found'));
});

test('StaticTestRunner: markdown fence внутри кода → fail', async () => {
  const code = '```kotlin\nclass TokenStore {}\n```';
  const result = await new StaticTestRunner().run(code, task);
  assert.equal(result.ok, false);
  assert.ok(result.checks.some((c) => c.name === 'no-markdown-fence' && !c.ok));
});

test('StaticTestRunner: строки/комментарии не ломают баланс', async () => {
  const code = 'class A {\n  val s = "}{"\n  // }\n  val t = \'{\'\n}';
  const result = await new StaticTestRunner().run(code, {
    ...task,
    requiredPatterns: [],
  });
  assert.equal(result.ok, true, result.checks.map((c) => c.detail ?? c.name).join(', '));
});

test('CommandTestRunner: node-файл проходит', async () => {
  const runner = new CommandTestRunner({ command: 'node', args: ['{file}'] });
  const result = await runner.run('console.log("ok");', {
    ...task,
    fileName: 'main.mjs',
    requiredPatterns: [],
  });
  assert.equal(result.ok, true, result.checks[0]?.detail);
});

test('CommandTestRunner: падение команды → fail с безопасным detail', async () => {
  const runner = new CommandTestRunner({ command: 'node', args: ['{file}'] });
  const result = await runner.run('throw new Error("boom sk-proj-abc123");', {
    ...task,
    fileName: 'main.mjs',
    requiredPatterns: [],
  });
  assert.equal(result.ok, false);
  const detail = result.checks[0]?.detail ?? '';
  assert.ok(detail.includes('[REDACTED_API_KEY]'));
  assert.ok(!detail.includes('sk-proj-abc123'));
});
