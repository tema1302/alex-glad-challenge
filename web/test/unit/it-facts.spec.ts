// IT-факты для /joker: уникальность, непустота, отсутствие HTML-мусора.
import { describe, expect, it } from 'vitest';
import { IT_FACTS } from '../../lib/shared/it-facts';

describe('IT_FACTS — контент для отбивки ожидания', () => {
  it('фактов достаточно, чтобы не повторяться за сессию', () => {
    expect(IT_FACTS.length).toBeGreaterThanOrEqual(15);
  });

  it('все факты уникальны и непусты', () => {
    expect(new Set(IT_FACTS).size).toBe(IT_FACTS.length);
    for (const f of IT_FACTS) expect(f.trim().length).toBeGreaterThan(20);
  });

  it('без HTML и без потенциально опасной разметки (вставка как текст в React)', () => {
    for (const f of IT_FACTS) {
      expect(f).not.toMatch(/<[a-zA-Z/]/);
    }
  });

  it('без символов, которые выглядят как утечка другого языка (тот же класс, что guard joker)', () => {
    // Факты показываются людям — кириллица/латиница/цифры/пунктуация.
    // Проверяем каждый символ: regex с $-якорем, иначе один «плохой» в конце проскочил бы.
    const allowed = /^[\p{sc=Cyrillic}\p{sc=Latin}\p{P}\s\d«»№]+$/u;
    for (const f of IT_FACTS) {
      expect(allowed.test(f), `подозрительные символы в: ${f}`).toBe(true);
    }
  });
});
