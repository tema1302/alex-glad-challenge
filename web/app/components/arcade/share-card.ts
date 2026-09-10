// Тексты «Поделиться результатом» — чистый модуль: только строковая сборка и
// encodeURIComponent. Используется кнопками шаринга в аркаде (клипборд + ссылка
// t.me/share), юнит-тестируется без браузера.
import { levelFor, levelTitle, type GameId, type ProgressState } from './progress';

export const GAME_TITLES: Record<GameId, string> = {
  quiz: 'Викторина «Угадай модуль»',
  layers: 'Пазл «Собери архитектуру»',
  stack: 'Сортировка «Разложи стек»',
  sim: 'Симулятор «Один день редакции»',
};

const SITE_URL = 'http://127.0.0.1:3000/showcase';

/** Карточка результата одной игры: «🎯 Викторина — 8/8 …». */
export function buildResultShareText(result: {
  game: GameId;
  score: number;
  total: number;
}): string {
  const title = GAME_TITLES[result.game] ?? 'Аркада витрины';
  const perfect = result.total > 0 && result.score === result.total;
  const praise = perfect ? 'Без единой ошибки!' : 'Разбирай систему в игровой форме.';
  return `${title} — ${result.score}/${result.total}. ${praise} Попробуй сам:`;
}

/** Карточка профиля: уровень, XP, лучшая викторина и достижения. */
export function buildProfileShareText(progress: ProgressState): string {
  const level = levelFor(progress.xp);
  const facts: string[] = [];
  const quizBest = progress.bests.quiz;
  if (typeof quizBest === 'number' && quizBest > 0) {
    facts.push(`лучший счёт викторины — ${quizBest}/8`);
  }
  facts.push(
    progress.achievements.length > 0
      ? `достижений открыто: ${progress.achievements.length} из 7`
      : 'достижения ждут своего часа',
  );
  return [
    `Мой уровень в аркаде витрины — «${levelTitle(level)}», ${progress.xp} XP.`,
    `${facts.join(', ').replace(/^./, (c) => c.toUpperCase())}.`,
    'Заходи потыкать систему:',
  ].join(' ');
}

/** Ссылка «поделиться в Telegram» (Web Share-эндпоинт мессенджера). */
export function tgShareUrl(text: string, url: string = SITE_URL): string {
  return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
}
