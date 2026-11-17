// Тесты sanitizer'а tainted-контента (границы RSS/forum/TG → БД/промпт).

import test from 'node:test';
import assert from 'node:assert/strict';

import { clean, safeSlice, stripLoneSurrogates } from './sanitize.js';

test('clean: вырезает control-символы, сохраняя \\t и переносы', () => {
  assert.equal(clean('a\x00b\x08c\td\ne\x0bf\x1fg'), 'abc\td\nefg');
});

test('clean: обрезает по краям', () => {
  assert.equal(clean('  привет \n'), 'привет');
});

test('clean: режет длину по maxLen', () => {
  assert.equal(clean('длинная строка', 7), 'длинная');
});

test('clean: без maxLen длина не ограничивается', () => {
  const long = 'x'.repeat(500);
  assert.equal(clean(long).length, 500);
});

test('clean: идемпотентен (повторный вызов не меняет результат)', () => {
  const once = clean('\x01текст\x02 <script>', 20);
  assert.equal(clean(once, 20), once);
});

test('clean: пустая и пробельная строки', () => {
  assert.equal(clean(''), '');
  assert.equal(clean('   \n\t  '), '');
});

// Регрессия LLM 400: обрезка по UTF-16 единицам резала emoji пополам —
// непарный суррогат уходил в JSON запроса, DeepSeek отклонял тело с 400.
test('clean: обрезка не режет surrogate pair (emoji) пополам', () => {
  assert.equal(clean('абв🤣где', 4), 'абв');
  assert.equal(clean('абв🤣где', 5), 'абв🤣');
});

test('clean: вырезает непарные суррогаты, целые пары сохраняет', () => {
  assert.equal(clean('a\ud83eb'), 'ab');
  assert.equal(clean('a\udc00b'), 'ab');
  assert.equal(clean('🤣 ok'), '🤣 ok');
});

test('stripLoneSurrogates: непарные halves удалены, пары нетронуты', () => {
  assert.equal(stripLoneSurrogates('🤣\ud83eтекст\udc00!'), '🤣текст!');
  assert.equal(stripLoneSurrogates('обычный текст'), 'обычный текст');
});

test('safeSlice: граница внутри пары сдвигается назад, вне пары — как slice', () => {
  assert.equal(safeSlice('абв🤣где', 4), 'абв');
  assert.equal(safeSlice('абв🤣где', 5), 'абв🤣');
  assert.equal(safeSlice('абв🤣где', 3), 'абв');
  assert.equal(safeSlice('короткая', 100), 'короткая');
  assert.equal(safeSlice('абв', 0), '');
});
