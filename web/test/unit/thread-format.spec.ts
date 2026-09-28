// Unit: чистые хелперы формата потока «Поток-перевод» (lib/server/thread-format).
// Разбор ответа модели по разделителям ===ПОСТ=== и страховка лимита ТГ (4000).
import { describe, expect, it } from 'vitest';

import { TG_MAX_POST_LEN, splitLongPost, splitThreadResponse } from '../../lib/server/thread-format';

describe('splitThreadResponse', () => {
  it('строгий разделитель ===ПОСТ=== делит ответ на посты', () => {
    const raw = 'Пост раз.\n\nПанч.\n===ПОСТ===\nПост два.\n===ПОСТ===\nПрим. переводчика: всё.';
    expect(splitThreadResponse(raw)).toEqual([
      'Пост раз.\n\nПанч.',
      'Пост два.',
      'Прим. переводчика: всё.',
    ]);
  });

  it('допускает вариации модели: пробелы, нумерация, дефисы, лишний регистр', () => {
    const raw = ['один', '=== ПОСТ 2 ===', 'два', '---пост---', 'три', '==ПОСТ==', 'четыре'].join('\n');
    expect(splitThreadResponse(raw)).toEqual(['один', 'два', 'три', 'четыре']);
  });

  it('без разделителей — один пост (фолбэк, не потеря)', () => {
    expect(splitThreadResponse('Один цельный пост.')).toEqual(['Один цельный пост.']);
  });

  it('пустые куски и обёрточные переводы строк отбрасываются', () => {
    const raw = '\n\n===ПОСТ===\n\n===ПОСТ===\nтолько один непустой\n===ПОСТ===\n   \n';
    expect(splitThreadResponse(raw)).toEqual(['только один непустой']);
  });

  it('упоминание ПОСТ внутри строки текста не делит поток', () => {
    const raw = 'Смотри ===ПОСТ=== прямо в тексте — это не разделитель.';
    expect(splitThreadResponse(raw)).toEqual(['Смотри ===ПОСТ=== прямо в тексте — это не разделитель.']);
  });
});

describe('splitLongPost', () => {
  it('короткий пост возвращается без изменений', () => {
    const post = 'Короткий пост.';
    expect(splitLongPost(post)).toEqual([post]);
    expect(splitLongPost(post, TG_MAX_POST_LEN)).toHaveLength(1);
  });

  it('режет по границе абзацев, сохраняя содержимое и порядок', () => {
    const paragraph = 'а'.repeat(100);
    const post = Array.from({ length: 60 }, () => paragraph).join('\n\n');
    const parts = splitLongPost(post);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(TG_MAX_POST_LEN);
    }
    expect(parts.map((p) => p.split('\n\n').length).reduce((a, b) => a + b, 0)).toBe(60);
  });

  it('абзац без пустых строк, длиннее max — режется по строкам', () => {
    const line = 'б'.repeat(1500);
    const post = Array.from({ length: 5 }, () => line).join('\n');
    const parts = splitLongPost(post, 4000);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(4000);
    }
    expect(parts.join('\n')).toBe(post);
  });

  it('одна гигантская строка — жёсткий разрез по max, без потери символов', () => {
    const post = 'в'.repeat(9000);
    const parts = splitLongPost(post, 4000);
    expect(parts.map((p) => p.length)).toEqual([4000, 4000, 1000]);
    expect(parts.join('')).toBe(post);
  });

  it('граница: ровно max — не режется', () => {
    const post = 'г'.repeat(4000);
    expect(splitLongPost(post, 4000)).toEqual([post]);
  });
});
