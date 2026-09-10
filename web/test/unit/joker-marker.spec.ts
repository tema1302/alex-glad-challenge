// CINE-PUN маркер и детектор zh-утечки: контракт regex + поведение сэмплера.
import { describe, expect, it } from 'vitest';
import {
  JOKER_MARKER_RE,
  hasJokerMarker,
  leakageSample,
} from '../../lib/shared/joker-marker';

describe('hasJokerMarker — «🎬 Фильм (год) — сцена»', () => {
  it('реальный формат маркера проходит', () => {
    expect(hasJokerMarker('🎬 Матрица (1999) — Нео видит код')).toBe(true);
    expect(hasJokerMarker('🎬 Терминатор (1984) — прибудет голым\nи дальше реплика')).toBe(true);
  });

  it('допускает en-dash и дефис как разделитель', () => {
    expect(hasJokerMarker('🎬 Бразилия (1985) – вечер в Рио')).toBe(true);
    expect(hasJokerMarker('🎬 Пикник (1972) - сцена у костра')).toBe(true);
  });

  it('регэксп требует эмодзи, непустое название и 4-значный год', () => {
    expect(JOKER_MARKER_RE.test('Матрица (1999) — сцена')).toBe(false); // нет 🎬
    expect(JOKER_MARKER_RE.test('🎬 (1999) — сцена')).toBe(false); // нет названия
    expect(JOKER_MARKER_RE.test('🎬 Фильм (99) — сцена')).toBe(false); // год не 4 цифры
    expect(JOKER_MARKER_RE.test('🎬 Фильм 1999 — сцена')).toBe(false); // год без скобок
  });

  it('пустой ответ и ответ без маркера отклоняются', () => {
    expect(hasJokerMarker('')).toBe(false);
    expect(hasJokerMarker('Просто реплика без маркера')).toBe(false);
  });

  it('маркер обязан быть в первой строке; на последующих — не считается', () => {
    expect(hasJokerMarker('первая строка\n🎬 Матрица (1999) — сцена')).toBe(false);
  });
});

describe('leakageSample — детектор не-кириллицы/латиницы', () => {
  it('чистый русский текст — утечки нет', () => {
    expect(leakageSample('🎬 Фильм (1999) — сцена\nРеплика на русском, 12 цифр и № знаков!')).toEqual(
      { has: false, sample: '' },
    );
  });

  it('латиница в крылатых фразах легитимна', () => {
    expect(leakageSample('🎬 Терминатор (1984) — сцена\nОн говорит: I\'ll be back, и всё!')).toEqual(
      { has: false, sample: '' },
    );
  });

  it('CJK-иероглифы в теле реплики — утечка с сэмплом контекста', () => {
    const r = leakageSample('🎬 Фильм (1999) — сцена\n你好你好你好 мир');
    expect(r.has).toBe(true);
    expect(r.sample).toContain('你好');
  });

  it('единичные редкие символы не шумят (порог по количеству и доле)', () => {
    expect(leakageSample('🎬 Фильм (1999) — сцена\nОдин символ 你 тут')).toEqual({
      has: false,
      sample: '',
    });
  });

  it('пустой ответ и тело без переноса строки обрабатываются', () => {
    expect(leakageSample('')).toEqual({ has: false, sample: '' });
    expect(leakageSample('🎬 Короткий (2001) — вся реплика в первой строке')).toEqual({
      has: false,
      sample: '',
    });
  });
});
