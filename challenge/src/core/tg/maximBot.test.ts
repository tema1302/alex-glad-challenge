import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isHotDay,
  computeNextNudgeAt,
  toCapsText,
  buildCapsMessage,
  parseMaximCommand,
  parseTemperature,
  isAddressedToBot,
  stripAddress,
  pickMood,
} from './maximBot.js';

const EPOCH = '2026-10-06'; // релиз 41
const PERIOD = 14;

test('isHotDay: день релиза и следующий — hot, дальше — нет', () => {
  assert.equal(isHotDay(new Date(2026, 9, 6, 15, 0), EPOCH, PERIOD), true); // релиз 41
  assert.equal(isHotDay(new Date(2026, 9, 7, 9, 0), EPOCH, PERIOD), true); // день после
  assert.equal(isHotDay(new Date(2026, 9, 8, 9, 0), EPOCH, PERIOD), false);
  assert.equal(isHotDay(new Date(2026, 9, 20, 12, 0), EPOCH, PERIOD), true); // релиз 43
  assert.equal(isHotDay(new Date(2026, 9, 21, 12, 0), EPOCH, PERIOD), true);
  assert.equal(isHotDay(new Date(2026, 9, 19, 23, 59), EPOCH, PERIOD), false);
  assert.equal(isHotDay(new Date(2026, 9, 5, 12, 0), EPOCH, PERIOD), false); // до эпохи
  assert.equal(isHotDay(new Date(2026, 9, 6), 'кривая-дата', PERIOD), false);
});

const SCHED = {
  releaseEpoch: EPOCH,
  releasePeriodDays: PERIOD,
  dailyWindowStartHour: 10,
  dailyWindowEndHour: 20,
  hotIntervalMinMin: 60,
  hotIntervalMaxMin: 180,
  normalIntervalDays: 3,
};

test('computeNextNudgeAt: hot-день — через 60–180 минут', () => {
  const now = new Date(2026, 9, 20, 15, 0); // день релиза 43
  const next = computeNextNudgeAt(now, SCHED, () => 0.5);
  const deltaMin = (next - now.getTime()) / 60_000;
  assert.ok(deltaMin >= 60 && deltaMin <= 180, `delta=${deltaMin}`);
});

test('computeNextNudgeAt: обычный день — слот в окне 10–20 сегодня или через 3 дня', () => {
  const morning = new Date(2026, 9, 8, 8, 0); // обычный день, слот ещё впереди
  const nextMorning = computeNextNudgeAt(morning, SCHED, () => 0);
  assert.equal(nextMorning, new Date(2026, 9, 8, 10, 0).getTime());

  const evening = new Date(2026, 9, 8, 21, 0); // слот прошёл → через 3 дня
  const nextEvening = computeNextNudgeAt(evening, SCHED, () => 0);
  assert.equal(nextEvening, new Date(2026, 9, 11, 10, 0).getTime());

  const noon = new Date(2026, 9, 8, 12, 0); // внутри окна → слот сегодня до 20:00
  const inWindow = computeNextNudgeAt(noon, SCHED, () => 0.999);
  assert.ok(inWindow > noon.getTime());
  assert.ok(inWindow <= new Date(2026, 9, 8, 20, 0).getTime());
});

test('toCapsText: верхний регистр и восклицания', () => {
  assert.equal(toCapsText('с продом повнимательнее'), 'С ПРОДОМ ПОВНИМАТЕЛЬНЕЕ!!!');
  assert.equal(toCapsText('переводи в ревью!'), 'ПЕРЕВОДИ В РЕВЬЮ!');
});

test('buildCapsMessage: капс + пинги, без пингов — только капс', () => {
  assert.equal(
    buildCapsMessage('с продом повнимательнее', ['sevens', 'temi4']),
    'С ПРОДОМ ПОВНИМАТЕЛЬНЕЕ!!!\n@sevens @temi4',
  );
  assert.equal(buildCapsMessage('переводи в ревью', []), 'ПЕРЕВОДИ В РЕВЬЮ!!!');
  assert.equal(buildCapsMessage('переводи в ревью', ['']), 'ПЕРЕВОДИ В РЕВЬЮ!!!');
});

test('parseMaximCommand: префиксные команды, аргументы, @суффикс', () => {
  assert.deepEqual(parseMaximCommand('/start'), { name: 'start', arg: '' });
  assert.deepEqual(parseMaximCommand('/start@alert_max_temi4_bot', 'alert_max_temi4_bot'), {
    name: 'start',
    arg: '',
  });
  assert.deepEqual(parseMaximCommand('/maxim_temp'), { name: 'temp', arg: '' });
  assert.deepEqual(parseMaximCommand('/maxim_temp 1.3'), { name: 'temp', arg: '1.3' });
  assert.deepEqual(parseMaximCommand('/maxim_say'), { name: 'say', arg: '' });
  assert.deepEqual(parseMaximCommand('/maxim_status'), { name: 'status', arg: '' });
  assert.deepEqual(parseMaximCommand('/MAXIM_TEMP@alert_max_temi4_bot 0.5', 'alert_max_temi4_bot'), {
    name: 'temp',
    arg: '0.5',
  });
  assert.equal(parseMaximCommand('/maxim_temp@OtherBot 0.5', 'alert_max_temi4_bot'), null);
  assert.equal(parseMaximCommand('/temp 1.3'), null); // без префикса — не наша
  assert.equal(parseMaximCommand('просто текст'), null);
});

test('parseTemperature: 0–2, запятая, мусор — null', () => {
  assert.equal(parseTemperature('1.3'), 1.3);
  assert.equal(parseTemperature('0'), 0);
  assert.equal(parseTemperature('2'), 2);
  assert.equal(parseTemperature('0,7'), 0.7);
  assert.equal(parseTemperature('2.1'), null);
  assert.equal(parseTemperature('-1'), null);
  assert.equal(parseTemperature('много'), null);
});

const BOT = { botId: 8974515926, botUsername: 'alert_max_temi4_bot' };

test('isAddressedToBot: реплай боту, @упоминание, имя в начале', () => {
  assert.equal(isAddressedToBot({ text: 'ок', replyFromId: BOT.botId, ...BOT }), true);
  assert.equal(isAddressedToBot({ text: 'ок', replyFromId: 123, ...BOT }), false);
  assert.equal(isAddressedToBot({ text: '@alert_max_temi4_bot глянь задачу', ...BOT }), true);
  assert.equal(isAddressedToBot({ text: 'глянь @ALERT_MAX_TEMI4_BOT задачу', ...BOT }), true);
  assert.equal(isAddressedToBot({ text: 'максим, с продом что?', ...BOT }), true);
  assert.equal(isAddressedToBot({ text: 'Максим Артемьевич! тесты упали', ...BOT }), true);
  assert.equal(isAddressedToBot({ text: 'макс: прими ревью', ...BOT }), true);
  assert.equal(isAddressedToBot({ text: 'а максим в курсе?', ...BOT }), false); // имя не в начале
  assert.equal(isAddressedToBot({ text: 'максимилиан, привет', ...BOT }), false); // другое имя
  assert.equal(isAddressedToBot({ text: 'просто сообщение в чат', ...BOT }), false);
});

test('stripAddress: срезает @упоминание и ведущее имя', () => {
  assert.equal(stripAddress('@alert_max_temi4_bot глянь задачу', BOT.botUsername), 'глянь задачу');
  assert.equal(stripAddress('максим, с продом что?', BOT.botUsername), 'с продом что?');
  assert.equal(stripAddress('Максим Артемьевич! тесты упали', BOT.botUsername), 'тесты упали');
  assert.equal(stripAddress('просто текст', BOT.botUsername), 'просто текст');
});

test('pickMood: вспышка по кубику', () => {
  assert.equal(pickMood(() => 0.0), 'angry');
  assert.equal(pickMood(() => 0.149), 'angry');
  assert.equal(pickMood(() => 0.15), 'calm');
  assert.equal(pickMood(() => 0.9), 'calm');
});
