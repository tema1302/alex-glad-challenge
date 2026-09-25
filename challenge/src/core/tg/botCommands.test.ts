import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, extractInvocation, BOT_COMMANDS } from './botCommands.js';

test('parseCommand: базовые команды M1', () => {
  assert.deepEqual(parseCommand('/цитата'), { name: 'цитата', args: '' });
  assert.deepEqual(parseCommand('/цитата севенс'), { name: 'цитата', args: 'севенс' });
  assert.deepEqual(parseCommand('/сказал севенс парковка у ТТК'), {
    name: 'сказал',
    args: 'севенс парковка у ТТК',
  });
  assert.deepEqual(parseCommand('/игра'), { name: 'игра', args: '' });
  assert.deepEqual(parseCommand('/стат'), { name: 'стат', args: '' });
  assert.deepEqual(parseCommand('/reindex'), { name: 'reindex', args: '' });
  assert.deepEqual(parseCommand('/алиас сёва Saveliy'), { name: 'алиас', args: 'сёва Saveliy' });
  assert.deepEqual(parseCommand('/off'), { name: 'off', args: '' });
  assert.deepEqual(parseCommand('/on'), { name: 'on', args: '' });
});

test('parseCommand: регистр и @имя-бота', () => {
  assert.deepEqual(parseCommand('/ЦИТАТА'), { name: 'цитата', args: '' });
  const r = parseCommand('/сказал@FactchempikBot парковка', 'FactchempikBot');
  assert.deepEqual(r, { name: 'сказал', args: 'парковка' });
  assert.equal(parseCommand('/цитата@OtherBot', 'FactchempikBot'), null);
});

test('parseCommand: /изобрази <имя> [тема…]', () => {
  assert.deepEqual(parseCommand('/изобрази севенс парковка'), {
    name: 'изобрази',
    args: 'севенс парковка',
  });
  assert.deepEqual(parseCommand('/ИЗОБРАЗИ савелий'), { name: 'изобрази', args: 'савелий' });
  assert.deepEqual(parseCommand('/изобрази@FactchempikBot севенс', 'FactchempikBot'), {
    name: 'изобрази',
    args: 'севенс',
  });
  assert.deepEqual(parseCommand('/изобрази'), { name: 'изобрази', args: '' });
});

test('parseCommand: не-команды и чужие команды → null', () => {
  assert.equal(parseCommand(null), null);
  assert.equal(parseCommand(''), null);
  assert.equal(parseCommand('привет /цитата'), null);
  assert.equal(parseCommand('/неизвестная foo'), null);
});

test('extractInvocation: @упоминание «на это сказал …»', () => {
  const r = extractInvocation('@FactchempikBot на это сказал савелий трансферы', 'FactchempikBot');
  assert.deepEqual(r, { name: 'сказал', args: 'савелий трансферы' });
  const r2 = extractInvocation('@factchempikbot сказал севенс судейство', 'FactchempikBot');
  assert.deepEqual(r2, { name: 'сказал', args: 'севенс судейство' });
});

test('extractInvocation: @упоминание с командой и «как бы»', () => {
  assert.deepEqual(extractInvocation('@factchempik /цитата', 'factchempik'), { name: 'цитата', args: '' });
  assert.deepEqual(extractInvocation('@factchempik как бы отреагировал краснобелый', 'factchempik'), {
    name: 'какбы',
    args: '',
  });
  assert.equal(extractInvocation('@factchempik', 'factchempik'), null);
});

test('extractInvocation: обычный текст не инвокация', () => {
  assert.equal(extractInvocation('на это сказал савелий', 'factchempik'), null);
  assert.equal(extractInvocation('просто сообщение @другойбот', 'factchempik'), null);
});

test('BOT_COMMANDS: фиксированный набор M1 + игра «Изобрази»', () => {
  assert.deepEqual(
    [...BOT_COMMANDS].sort(),
    ['off', 'on', 'reindex', 'алиас', 'игра', 'изобрази', 'сказал', 'стат', 'цитата'],
  );
});
