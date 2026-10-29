// Share-карточки аркады: тексты для клипборда и t.me/share-ссылки.
import { describe, expect, it } from 'vitest';
import {
  buildProfileShareText,
  buildResultShareText,
  GAME_TITLES,
  tgShareUrl,
} from '../../app/components/arcade/share-card';
import { EMPTY_PROGRESS, type ProgressState } from '../../app/components/arcade/progress';

describe('buildResultShareText', () => {
  it('называет игру, счёт и поощряет попробовать', () => {
    const text = buildResultShareText({ game: 'quiz', score: 6, total: 8 });
    expect(text).toContain('Викторина «Угадай модуль»');
    expect(text).toContain('6/8');
    expect(text.length).toBeGreaterThan(10);
  });

  it('идеальный результат хвастается вслух', () => {
    const perfect = buildResultShareText({ game: 'quiz', score: 8, total: 8 });
    const imperfect = buildResultShareText({ game: 'quiz', score: 5, total: 8 });
    expect(perfect).toContain('Без единой ошибки');
    expect(imperfect).not.toContain('Без единой ошибки');
  });

  it('для каждой игры — человекочитаемый заголовок', () => {
    for (const game of Object.keys(GAME_TITLES) as Array<keyof typeof GAME_TITLES>) {
      const text = buildResultShareText({ game, score: 1, total: 1 });
      expect(text).toContain(GAME_TITLES[game]);
    }
  });
});

describe('buildProfileShareText', () => {
  it('называет уровень, XP и количество достижений', () => {
    const p: ProgressState = {
      xp: 120,
      plays: { quiz: 3 },
      bests: { quiz: 8 },
      achievements: ['first-steps', 'sharp-eye', 'rising-star'],
    };
    const text = buildProfileShareText(p);
    expect(text).toContain('120 XP');
    expect(text).toContain('достижений открыто: 3 из 7');
    expect(text).toContain('8/8');
  });

  it('без достижений — дружелюбная формулировка вместо нуля', () => {
    const text = buildProfileShareText(EMPTY_PROGRESS);
    expect(text).not.toContain('0 из 7');
    expect(text.toLowerCase()).toContain('достижения ждут своего часа');
  });

  it('без викторины не упоминает её рекорд', () => {
    const text = buildProfileShareText({ xp: 0, plays: {}, bests: {}, achievements: [] });
    expect(text).not.toContain('/8');
  });
});

describe('tgShareUrl', () => {
  it('кодирует текст и адрес в t.me/share/url', () => {
    const url = tgShareUrl('Викторина — 8/8. Без единой ошибки!', 'http://127.0.0.1:3000/showcase');
    expect(url.startsWith('https://t.me/share/url?')).toBe(true);
    expect(url).toContain(`url=${encodeURIComponent('http://127.0.0.1:3000/showcase')}`);
    expect(url).toContain(encodeURIComponent('8/8'));
    // Кириллица и спецсимволы не ломают URL
    expect(() => decodeURIComponent(url)).not.toThrow();
  });

  it('адрес по умолчанию — витрина', () => {
    expect(tgShareUrl('тест')).toContain(encodeURIComponent('http://127.0.0.1:3000/showcase'));
  });
});
