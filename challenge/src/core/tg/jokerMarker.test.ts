import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasFaktMarker,
  buildFaktFallback,
  guardImaginedReply,
  MAX_GUARD_ATTEMPTS,
} from './jokerMarker.js';

const VALID =
  '🎭 Это воображаемая реплика в манере Saveliy, не настоящая\nНу всё, классика жанра.';

test('hasFaktMarker: валидный маркер первой строкой', () => {
  assert.equal(hasFaktMarker(VALID), true);
});

test('hasFaktMarker: маркер не в первой строке → невалид', () => {
  assert.equal(hasFaktMarker('Привет!\n🎭 Это воображаемая реплика в манере X, не настоящая'), false);
});

test('hasFaktMarker: без маркера/без слова «воображаем» → невалид', () => {
  assert.equal(hasFaktMarker(''), false);
  assert.equal(hasFaktMarker('Ну всё, классика жанра.'), false);
  assert.equal(hasFaktMarker('🎭 Просто эмоция без контракта'), false);
});

test('guardImaginedReply: валид проходит без ретрая', async () => {
  let calls = 0;
  const r = await guardImaginedReply(async () => {
    calls++;
    return VALID;
  }, 'Saveliy');
  assert.equal(r.passed, true);
  assert.equal(r.text, VALID);
  assert.equal(calls, 1);
});

test('guardImaginedReply: невалид → ровно 1 ретрай → fallback', async () => {
  let calls = 0;
  const r = await guardImaginedReply(async () => {
    calls++;
    return 'Выдумка без маркера';
  }, 'Sevens ABSOLute');
  assert.equal(calls, MAX_GUARD_ATTEMPTS);
  assert.equal(r.passed, false);
  assert.equal(hasFaktMarker(r.text), true, 'fallback обязан содержать валидный маркер');
  assert.ok(r.text.includes('Sevens ABSOLute'));
  assert.ok(r.text.startsWith('🎭 '));
});

test('guardImaginedReply: первая невалидная, вторая валидная → ретрай спасает', async () => {
  let calls = 0;
  const r = await guardImaginedReply(async () => {
    calls++;
    return calls === 1 ? 'мимо контракта' : VALID;
  }, 'Saveliy');
  assert.equal(calls, 2);
  assert.equal(r.passed, true);
});

test('guardImaginedReply: генератор падает → fallback без вылета', async () => {
  let calls = 0;
  const r = await guardImaginedReply(async () => {
    calls++;
    throw new Error('стилизатор недоступен');
  }, 'krasnobeliy2');
  assert.equal(calls, MAX_GUARD_ATTEMPTS);
  assert.equal(r.passed, false);
  assert.equal(hasFaktMarker(r.text), true);
});

test('buildFaktFallback: сам валиден по гейту', () => {
  assert.equal(hasFaktMarker(buildFaktFallback('Тест')), true);
});
