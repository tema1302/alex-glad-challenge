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
  const r = parseCommand('/сказал@MediumBot парковка', 'MediumBot');
  assert.deepEqual(r, { name: 'сказал', args: 'парковка' });
  assert.equal(parseCommand('/цитата@OtherBot', 'MediumBot'), null);
});

test('parseCommand: /изобрази <имя> [тема…]', () => {
  assert.deepEqual(parseCommand('/изобрази севенс парковка'), {
    name: 'изобрази',
    args: 'севенс парковка',
  });
  assert.deepEqual(parseCommand('/ИЗОБРАЗИ савелий'), { name: 'изобрази', args: 'савелий' });
  assert.deepEqual(parseCommand('/изобрази@MediumBot севенс', 'MediumBot'), {
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
  const r = extractInvocation('@MediumBot на это сказал савелий трансферы', 'MediumBot');
  assert.deepEqual(r, { name: 'сказал', args: 'савелий трансферы' });
  const r2 = extractInvocation('@mediumbot сказал севенс судейство', 'MediumBot');
  assert.deepEqual(r2, { name: 'сказал', args: 'севенс судейство' });
});

test('extractInvocation: @упоминание с командой и «как бы»', () => {
  assert.deepEqual(extractInvocation('@medium /цитата', 'medium'), { name: 'цитата', args: '' });
  assert.deepEqual(extractInvocation('@medium как бы отреагировал краснобелый', 'medium'), {
    name: 'какбы',
    args: '',
  });
  assert.equal(extractInvocation('@medium', 'medium'), null);
});

test('parseCommand: латинские алиасы меню Telegram', () => {
  assert.deepEqual(parseCommand('/quote'), { name: 'цитата', args: '' });
  assert.deepEqual(parseCommand('/QUOTE'), { name: 'цитата', args: '' });
  assert.deepEqual(parseCommand('/said севенс парковка'), {
    name: 'сказал',
    args: 'севенс парковка',
  });
  assert.deepEqual(parseCommand('/game'), { name: 'игра', args: '' });
  assert.deepEqual(parseCommand('/improv севенс'), { name: 'изобрази', args: 'севенс' });
  assert.deepEqual(parseCommand('/stat'), { name: 'стат', args: '' });
  assert.deepEqual(parseCommand('/alias сёва Saveliy'), { name: 'алиас', args: 'сёва Saveliy' });
  assert.deepEqual(parseCommand('/reindex'), { name: 'reindex', args: '' });
});

test('parseCommand: /start не игровая команда (обрабатывается отдельно в bot.ts)', () => {
  assert.equal(parseCommand('/start'), null);
  assert.equal(parseCommand('/start@memo7repost_bot', 'memo7repost_bot'), null);
});

test('extractInvocation: обычный текст не инвокация', () => {
  assert.equal(extractInvocation('на это сказал савелий', 'medium'), null);
  assert.equal(extractInvocation('просто сообщение @другойбот', 'medium'), null);
});

test('BOT_COMMANDS: фиксированный набор M1 + игра «Изобрази»', () => {
  assert.deepEqual(
    [...BOT_COMMANDS].sort(),
    ['off', 'on', 'reindex', 'алиас', 'игра', 'изобрази', 'сказал', 'стат', 'цитата'],
  );
});
