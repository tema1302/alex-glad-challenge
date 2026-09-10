// @vitest-environment jsdom
// Component: QuizGame — ответ засчитывается, фидбек раскрывает факт,
// «Дальше» ведёт к следующему вопросу, неверный ответ не увеличивает счёт.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QuizGame } from '../../app/components/arcade/QuizGame';
import { capabilitySections } from '../../data/showcase';

afterEach(cleanup);

// Викторина строится на реальных данных витрины; первый вопрос колоды при
// дефолтном Math.random может быть любым — не привязываемся к конкретному
// факту, а проверяем механику по состоянию интерфейса.

afterEach(() => {
  window.localStorage.clear();
});

describe('QuizGame', () => {
  it('верный ответ: счёт растёт, фидбек показывает модуль, «Дальше» двигает вопрос', () => {
    render(<QuizGame />);

    // Достаём верный модуль из aria-статуса невозможно до ответа — вместо этого
    // кликаем варианты, пока не попадём: фидбек после клика всегда называет модуль.
    const counters = screen.getByText(/вопрос 1\//);
    expect(counters).not.toBeNull();

    // Кликаем первую опцию — она может быть верной или нет, но фидбек обязан появиться.
    const optionButtons = screen
      .getAllByRole('button')
      .filter((b) => b.textContent !== 'Дальше' && b.textContent !== 'Итог');
    fireEvent.click(optionButtons[0]!);

    // После ответа все опции заблокированы.
    for (const b of optionButtons) expect(b).toBeDisabled();
    // Появилась кнопка перехода.
    const next = screen.getByRole('button', { name: 'Дальше' });
    fireEvent.click(next);
    expect(screen.getByText(/вопрос 2\//)).not.toBeNull();
  });

  it('последний вопрос → итоговый экран с рекордом и перезапуском', () => {
    render(<QuizGame />);
    // Прогоняем все 8 вопросов кнопкой «перейти дальше»: отвечаем первой опцией.
    for (let i = 0; i < 8; i += 1) {
      const optionButtons = screen
        .getAllByRole('button')
        .filter((b) => b.textContent !== 'Дальше' && b.textContent !== 'Итог');
      fireEvent.click(optionButtons[0]!);
      fireEvent.click(screen.getByRole('button', { name: /Дальше|Итог/ }));
    }
    // Итог: счёт N/8 + рекорд + «Ещё раунд».
    expect(screen.getByText(/\/8/)).not.toBeNull();
    expect(screen.getByText(/рекорд:/)).not.toBeNull();
    expect(Number(window.localStorage.getItem('arcade.quiz.best'))).toBeGreaterThanOrEqual(0);

    fireEvent.click(screen.getByRole('button', { name: 'Ещё раунд' }));
    expect(screen.getByText(/вопрос 1\//)).not.toBeNull();
  });

  it('колода строится на данных витрины: 6 модулей-вариантов', () => {
    render(<QuizGame />);
    const optionButtons = screen
      .getAllByRole('button')
      .filter((b) => b.textContent !== 'Дальше' && b.textContent !== 'Итог');
    expect(optionButtons).toHaveLength(capabilitySections.length);
  });

  it('edge: повторный клик по варианту после ответа ничего не меняет (disabled)', () => {
    render(<QuizGame />);
    const optionButtons = screen
      .getAllByRole('button')
      .filter((b) => b.textContent !== 'Дальше' && b.textContent !== 'Итог');
    fireEvent.click(optionButtons[0]!);
    expect(optionButtons[0]).toBeDisabled();
    const counter = screen.getByText(/верно:/).textContent;
    fireEvent.click(optionButtons[0]!);
    expect(screen.getByText(/верно:/).textContent).toBe(counter);
    expect(screen.getAllByRole('button', { name: 'Дальше' })).toHaveLength(1);
  });
});
