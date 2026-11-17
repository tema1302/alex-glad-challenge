// @vitest-environment jsdom
// LinkButton (S3 «Кнопки»): ссылка с внешностью кнопки из общего стилевого
// словаря Button (VARIANTS/SIZES/FOCUS). Контракт: role=link + href сохранены,
// варианты/размеры дают те же классы, что и у Button; square-режим не ломает
// доступное имя (aria-label).
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { LinkButton } from '../../app/components/ui/LinkButton';
import { IconExternal } from '../../app/components/ui/icons';

afterEach(cleanup);

describe('LinkButton', () => {
  it('ghost sm: ссылка с href и классами ghost-словаря/sm-размера', () => {
    render(<LinkButton href="/blog/posts?blog=main" variant="ghost" size="sm">Посты</LinkButton>);

    const link = screen.getByRole('link', { name: 'Посты' });
    expect(link).toHaveAttribute('href', '/blog/posts?blog=main');
    expect(link.className).toContain('border-line-strong');
    expect(link.className).toContain('text-dim');
    expect(link.className).toContain('min-h-[32px]');
  });

  it('primary md: классы accent-заливки и md-размера', () => {
    render(<LinkButton href="/blog/settings" variant="primary" size="md">Создать блог</LinkButton>);

    const link = screen.getByRole('link', { name: 'Создать блог' });
    expect(link.className).toContain('bg-accent');
    expect(link.className).toContain('text-accent-ink');
    expect(link.className).toContain('min-h-[36px]');
  });

  it('square: квадратный иконочный режим, доступное имя — из aria-label', () => {
    render(
      <LinkButton href="/blog/posts/7" variant="ghost" size="sm" square aria-label="Открыть пост #7">
        <IconExternal />
      </LinkButton>,
    );

    const link = screen.getByRole('link', { name: 'Открыть пост #7' });
    expect(link).toHaveAttribute('href', '/blog/posts/7');
    expect(link.className).toContain('aspect-square');
    expect(link.className).toContain('!px-0');
  });
});
