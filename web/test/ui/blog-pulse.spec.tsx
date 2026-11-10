// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { BlogPulse } from '../../app/dashboard/BlogPulse';

afterEach(cleanup);

const TOTALS = { active: 2, needsAttention: 1, postsLast7Days: 3, customPrompts: 2 };

describe('BlogPulse', () => {
  it('показывает сводку и карточки блогов со ссылками', () => {
    render(
      <BlogPulse
        totals={TOTALS}
        blogs={[
          {
            id: 1,
            slug: 'main',
            name: 'Главный',
            readyForNews: true,
            counts: { postsLast7Days: 3 },
          },
          {
            id: 2,
            slug: 'church',
            name: 'Храм',
            readyForNews: false,
            counts: { postsLast7Days: 0 },
          },
        ]}
      />,
    );

    expect(screen.getByTestId('blog-pulse')).toBeInTheDocument();
    expect(screen.getByText('Главный')).toBeInTheDocument();
    expect(screen.getByText('Храм')).toBeInTheDocument();
    expect(screen.getByText('готов')).toBeInTheDocument();
    expect(screen.getByText('нужна настройка')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Главный/ })).toHaveAttribute(
      'href',
      '/blog/settings/main',
    );
    expect(screen.getByRole('link', { name: /Все блоги/ })).toHaveAttribute('href', '/blog/settings');
  });

  it('пустой список показывает CTA создания блога', () => {
    render(<BlogPulse totals={{ ...TOTALS, active: 0 }} blogs={[]} />);
    expect(screen.getByText('Блогов пока нет')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Создать блог' })).toHaveAttribute('href', '/blog/settings');
  });
});
