// Тесты библиотеки кейсов, глоссария и коуча sec-chat (days 11–12).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GLOSSARY,
  RED_TEAM_CASES,
  coachHint,
  findGlossaryEntry,
  findPromptVariant,
  findRedTeamCase,
  nextUntriedCase,
  promptVariants,
  topicHint,
} from './redTeamCases.js';
import { classifyInput } from './redTeamChat.js';

test('RED_TEAM_CASES: 5 основных + 2 дополнительных, id и номера уникальны', () => {
  assert.equal(RED_TEAM_CASES.filter((c) => !c.bonus).length, 5);
  assert.equal(RED_TEAM_CASES.filter((c) => c.bonus).length, 2);
  assert.equal(new Set(RED_TEAM_CASES.map((c) => c.id)).size, RED_TEAM_CASES.length);
  assert.equal(new Set(RED_TEAM_CASES.map((c) => c.n)).size, RED_TEAM_CASES.length);
});

test('RED_TEAM_CASES: у каждого кейса заполнены источник, механика, защита и payload', () => {
  for (const item of RED_TEAM_CASES) {
    assert.ok(item.source.length > 10, `${item.id}: source`);
    assert.ok(item.whatItDoes.length > 10, `${item.id}: whatItDoes`);
    assert.ok(item.whyItWorks.length > 10, `${item.id}: whyItWorks`);
    assert.ok(item.defense.length > 10, `${item.id}: defense`);
    assert.ok(item.detectHint.length > 5, `${item.id}: detectHint`);
    assert.ok(item.payload.trim().length > 10, `${item.id}: payload`);
    assert.ok(item.canaries.length > 0, `${item.id}: canaries`);
  }
});

test('RED_TEAM_CASES: канарейки кейса реально присутствуют в payload', () => {
  for (const item of RED_TEAM_CASES) {
    for (const canary of item.canaries) {
      assert.ok(
        item.payload.toLowerCase().includes(canary.toLowerCase()),
        `${item.id}: канарейка «${canary}» не найдена в payload`,
      );
    }
  }
});

test('RED_TEAM_CASES: payload каждого кейса классифицируется как атака', () => {
  for (const item of RED_TEAM_CASES) {
    const c = classifyInput(item.payload);
    assert.equal(c.isAttack, true, `${item.id}: ${c.summary}`);
    assert.notEqual(c.primary, 'none', `${item.id}: primary`);
  }
});

test('findRedTeamCase: по номеру, id и регистру', () => {
  assert.equal(findRedTeamCase('1')?.id, 'ignore-above');
  assert.equal(findRedTeamCase('DAN')?.id, 'dan');
  assert.equal(findRedTeamCase('chatgpt-search')?.id, 'chatgpt-search');
  assert.equal(findRedTeamCase('нет-такого'), undefined);
  assert.equal(findRedTeamCase(''), undefined);
});

test('nextUntriedCase: первый непробованный, после всех — первый кейс', () => {
  assert.equal(nextUntriedCase([]).id, 'ignore-above');
  assert.equal(nextUntriedCase(['ignore-above']).id, 'dan');
  assert.equal(
    nextUntriedCase(RED_TEAM_CASES.map((c) => c.id)).id,
    'ignore-above',
  );
});

test('promptVariants: 7 вариантов, у каждого есть промпт и подсказка', () => {
  const variants = promptVariants('Гоша');
  assert.equal(variants.length, 7);
  assert.deepEqual(
    variants.map((v) => v.id),
    [
      'bank',
      'medium',
      'bank-hardened',
      'medium-hardened',
      'translator',
      'reviewer',
      'support',
    ],
  );
  for (const v of variants) {
    assert.ok(v.systemPrompt.length > 10, v.id);
    assert.ok(v.focus.length > 3, v.id);
    assert.ok(v.description.length > 5, v.id);
  }
});

test('findPromptVariant: id и алиасы hardened-bank / hardened-medium', () => {
  assert.equal(findPromptVariant('Гоша', 'translator')?.id, 'translator');
  assert.equal(findPromptVariant('Гоша', 'hardened-bank')?.id, 'bank-hardened');
  assert.equal(findPromptVariant('Гоша', 'hardened-medium')?.id, 'medium-hardened');
  assert.equal(findPromptVariant('Гоша', 'nope'), undefined);
});

test('каждый suggestedPrompt существует в promptVariants', () => {
  const ids = new Set(promptVariants('Гоша').map((v) => v.id));
  for (const item of RED_TEAM_CASES) {
    assert.ok(ids.has(item.suggestedPrompt), `${item.id}: ${item.suggestedPrompt}`);
  }
});

test('findGlossaryEntry: канарейка, FREEDOM и excess grant', () => {
  assert.equal(findGlossaryEntry('канарейка')?.id, 'canary');
  assert.equal(findGlossaryEntry('FREEDOM')?.id, 'freedom');
  assert.equal(findGlossaryEntry('excess grant')?.id, 'excess-grant');
  assert.equal(findGlossaryEntry('избыточные полномочия')?.id, 'excess-grant');
  assert.equal(findGlossaryEntry('джейлбрейк')?.id, 'jailbreak');
  assert.equal(findGlossaryEntry('нет-такого-термина'), undefined);
});

test('GLOSSARY: id уникальны, у всех есть короткое и подробное объяснение', () => {
  assert.equal(new Set(GLOSSARY.map((e) => e.id)).size, GLOSSARY.length);
  for (const e of GLOSSARY) {
    assert.ok(e.short.length > 5, e.id);
    assert.ok(e.detail.length > 20, e.id);
  }
});

test('topicHint: техника и неизвестный запрос', () => {
  assert.match(topicHint('override') ?? '', /Override/);
  assert.match(topicHint('role-play') ?? '', /Role-play/);
  assert.match(topicHint('role play') ?? '', /Role-play/);
  assert.equal(topicHint('unknown'), undefined);
});

test('coachHint: старт, отказ и успех дают разные следующие шаги', () => {
  assert.match(coachHint({ turns: 0, passed: 0, held: 0, ambiguous: 0 }), /\/cases/);
  assert.match(
    coachHint({
      turns: 1,
      passed: 0,
      held: 1,
      ambiguous: 0,
      lastVerdict: 'DEFENSE HELD',
      triedCaseIds: ['ignore-above'],
    }),
    /\/case 2/,
  );
  assert.match(
    coachHint({
      turns: 1,
      passed: 1,
      held: 0,
      ambiguous: 0,
      lastVerdict: 'ATTACK PASS',
    }),
    /усиленный промпт/,
  );
});
