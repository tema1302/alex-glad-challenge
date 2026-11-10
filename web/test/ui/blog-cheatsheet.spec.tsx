// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BlogCheatSheet } from '../../app/blog/settings/BlogCheatSheet';

afterEach(cleanup);

describe('BlogCheatSheet', () => {
  it('показывает 5 шагов и безопасный режим публикации', () => {
    render(<BlogCheatSheet />);

    expect(screen.getByText('шпаргалка · как пользоваться')).toBeInTheDocument();
    expect(screen.getByText('Откройте карточку блога')).toBeInTheDocument();
    expect(screen.getByText('Настройте голос')).toBeInTheDocument();
    expect(screen.getByText('Промпты агентов')).toBeInTheDocument();
    expect(screen.getByText('Пост или расписание')).toBeInTheDocument();
    expect(screen.getByText('Проверьте результат')).toBeInTheDocument();
    expect(screen.getByText(/по умолчанию\s+создаются черновики/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'автоматизации' })).toHaveAttribute(
      'href',
      '/automation',
    );
  });

  it('прячет Telegram-команду и FAQ в раскрываемый блок', () => {
    const { container } = render(<BlogCheatSheet />);

    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(screen.getByText('Telegram-команда и частые вопросы')).toBeInTheDocument();
    expect(
      screen.getByText('/пост <блог> [publish] <тема> [| комментарий]'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Публикуется только первый вариант/)).toBeInTheDocument();
    expect(screen.getByText(/Нет профиля голоса/)).toBeInTheDocument();
  });
});
