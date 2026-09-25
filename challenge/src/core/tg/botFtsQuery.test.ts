import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeTheme, buildFtsQuery, scoreQuote, themeFromReplyText } from './botFtsQuery.js';

test('tokenizeTheme: нормализация, стоп-слова, дедуп', () => {
  const tokens = tokenizeTheme('Парковка у ТТК и про парковку, не это');
  assert.deepEqual(tokens, ['парковка', 'ттк', 'про', 'парковку']);
});

test('buildFtsQuery: префиксная морфология через OR', () => {
  assert.equal(buildFtsQuery('судейство Челси'), 'судейство* OR челси*');
  assert.equal(buildFtsQuery('судьи'), 'судьи*');
});

test('buildFtsQuery: пусто/стоп-слова → пустая строка', () => {
  assert.equal(buildFtsQuery(''), '');
  assert.equal(buildFtsQuery('и на не что'), '');
});

test('buildFtsQuery: кап на число токенов', () => {
  const q = buildFtsQuery('а б в г д е ж'.split('').join(' ') + ' арбуз груша слива яблоко банан апельсин');
  assert.equal(q.split(' OR ').length, 6);
});

test('themeFromReplyText: 3–5 значимых слов реплики', () => {
  const theme = themeFromReplyText('Это что за парковка у ТТК, вы видели? И вообще это не так', 4);
  assert.equal(theme, 'парковка ттк видели вообще');
});

test('scoreQuote: реакции и свежесть детерминированы', () => {
  const now = Date.parse('2026-09-24T00:00:00Z');
  const fresh = scoreQuote(10, '2026-09-01T00:00:00Z', now);
  const old = scoreQuote(10, '2022-01-01T00:00:00Z', now);
  const hyped = scoreQuote(50, '2022-01-01T00:00:00Z', now);
  assert.ok(fresh > old, 'свежая цитата бустится');
  assert.ok(hyped > fresh, 'реакции перевешивают свежесть');
  assert.equal(scoreQuote(5, 'мусорная дата', now), 5, 'битая дата → без буста, реакции остаются');
});
