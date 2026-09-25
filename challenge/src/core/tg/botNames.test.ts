import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, resolveAuthor, collapseByAuthor, pickSuggestions, resolveGreedyName } from './botNames.js';
import type { AuthorEntry } from './botNames.js';

function entry(fromId: string, name: string, textMessages: number): AuthorEntry {
  return {
    fromId,
    name,
    messages: textMessages + 10,
    textMessages,
    firstDate: '2022-01-01T00:00:00.000Z',
    lastDate: '2026-09-01T00:00:00.000Z',
  };
}

test('normalizeName: trim, lower, ё→е, пробелы', () => {
  assert.equal(normalizeName('  СеВенс  '), 'севенс');
  assert.equal(normalizeName('Ёж Ёлка'), 'еж елка');
  assert.equal(normalizeName('  a   b  '), 'a b');
});

test('resolveAuthor: точный алиас бьёт подстроку', () => {
  const entries = [entry('1', 'Saveliy', 100), entry('2', 'Sevens ABSOLute', 90)];
  const aliases = new Map([['севенс', '2']]);
  const r = resolveAuthor('Севенс', entries, aliases);
  assert.equal(r.kind, 'ok');
  if (r.kind === 'ok') assert.equal(r.author.fromId, '2');
});

test('resolveAuthor: подстрока латиницей, один автор — молча', () => {
  const entries = [entry('1', 'Saveliy', 100), entry('2', 'Sevens ABSOLute', 90)];
  const r = resolveAuthor('savel', entries, new Map());
  assert.equal(r.kind, 'ok');
  if (r.kind === 'ok') assert.equal(r.author.fromId, '1');
});

test('resolveAuthor: неоднозначное имя → варианты, отсортированы по объёму', () => {
  const entries = [entry('1', 'Вячеслав', 30), entry('2', 'krasnobeliy2 Вячеслав', 90), entry('3', 'Polygonchik', 80)];
  const r = resolveAuthor('вячеслав', entries, new Map());
  assert.equal(r.kind, 'ambiguous');
  if (r.kind === 'ambiguous') {
    assert.equal(r.options.length, 2);
    assert.equal(r.options[0].fromId, '2');
  }
});

test('resolveAuthor: промах → отказ и до 3 подсказок', () => {
  const entries = [entry('1', 'Saveliy', 100), entry('2', 'Sevens ABSOLute', 90), entry('3', 'Temi4 Facts', 80), entry('4', 'tim', 70)];
  const r = resolveAuthor('гагарин', entries, new Map());
  assert.equal(r.kind, 'none');
  if (r.kind === 'none') {
    assert.ok(r.suggestions.length > 0);
    assert.ok(r.suggestions.length <= 3);
  }
});

test('resolveAuthor: числовой запрос = from_id', () => {
  const entries = [entry('662123302', 'Saveliy', 100)];
  const r = resolveAuthor('662123302', entries, new Map());
  assert.equal(r.kind, 'ok');
});

test('resolveAuthor: кириллический запрос не находит латинский ник без алиаса', () => {
  const entries = [entry('1', 'Saveliy', 100)];
  const r = resolveAuthor('савелий', entries, new Map());
  assert.equal(r.kind, 'none');
});

test('collapseByAuthor: один from_id с двумя именами склеивается', () => {
  const collapsed = collapseByAuthor([
    entry('1', 'Rayne', 10),
    entry('1', 'Ruslan', 35),
    entry('2', 'tim', 28),
  ]);
  assert.equal(collapsed.length, 2);
  const first = collapsed.find((e) => e.fromId === '1');
  assert.ok(first);
  assert.equal(first.name, 'Ruslan');
  assert.equal(first.messages, 10 + 35 + 20);
  assert.equal(first.textMessages, 45);
});

test('pickSuggestions: префиксный бонус и лимит', () => {
  const entries = [entry('1', 'Saveliy', 100), entry('2', 'Sevens ABSOLute', 90), entry('3', 'Temi4 Facts', 80), entry('4', 'tim', 70)];
  const s = pickSuggestions('te', entries, 3);
  assert.equal(s.length, 3);
  assert.equal(s[0].name, 'Temi4 Facts', 'префиксное совпадение — первая подсказка');
});

test('resolveGreedyName: амбигуальный первый токен → жадная попытка 2-токенного имени', () => {
  // Кейс ревью: «/сказал Вячеслав Назаренко парковка» — «вячеслав» амбигвален,
  // но «вячеслав назаренко» резолвится однозначно; кнопки не нужны.
  const entries = [
    entry('1', 'Вячеслав', 40),
    entry('2', 'krasnobeliy2 Вячеслав', 90),
    entry('3', 'Вячеслав Назаренко', 3),
  ];
  const resolve = (q: string) => resolveAuthor(q, entries, new Map());
  assert.equal(resolve('вячеслав').kind, 'ambiguous');

  const r = resolveGreedyName(['Вячеслав', 'Назаренко', 'парковка'], resolve);
  assert.equal(r.name, 'Вячеслав Назаренко');
  assert.deepEqual(r.themeWords, ['парковка']);
  assert.equal(r.result.kind, 'ok');
  if (r.result.kind === 'ok') assert.equal(r.result.author.fromId, '3');

  // Однословный амбигвал без продолжения — кнопки остаются кнопками.
  const solo = resolveGreedyName(['Вячеслав'], resolve);
  assert.equal(solo.result.kind, 'ambiguous');

  // 2-токенное имя тоже мимо → возвращаем исходный ambiguous первого токена.
  const miss = resolveGreedyName(['Вячеслав', 'Гагарин'], resolve);
  assert.equal(miss.result.kind, 'ambiguous');
  assert.equal(miss.name, 'Вячеслав');
  assert.deepEqual(miss.themeWords, ['Гагарин']);

  // Однозначный первый токен — 2-токенная попытка не делается.
  const ok = resolveGreedyName(['krasnobeliy2', 'лишнее'], resolve);
  assert.equal(ok.result.kind, 'ok');
  assert.deepEqual(ok.themeWords, ['лишнее']);
});
