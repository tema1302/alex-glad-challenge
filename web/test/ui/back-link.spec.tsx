// @vitest-environment jsdom
// UI: BackButton (S2 «Back&scroll», консилиум personal-space-S2-01) — умный
// «← назад»: in-app история есть → router.back() (мгновенный возврат без
// нового history-entry); прямой заход/login-redirect → честный fallback-push
// на адрес, который задаёт СТРАНИЦА (контекст ?blog= и т.п.), не компонент.
// Мок next/navigation — канон blog-post-publish.spec.tsx:9-16.
// Детерминизм: module-state (prevPath/returnFlag) живёт между тестами одного
// воркера — между кейсами sessionStorage.clear() + __testReset() из spaHistory.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
const back = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back }),
}));

import { BackButton } from '../../app/components/ui/BackButton';
import { __testReset, hasInAppHistory, markEnter } from '../../lib/shared/spaHistory';

afterEach(() => {
  cleanup();
  push.mockClear();
  back.mockClear();
  sessionStorage.clear();
  __testReset();
});

describe('BackButton (S2 Back&scroll)', () => {
  it('in-app история есть → router.back ровно один раз, push не зовётся', async () => {
    // SPA-сценарий: список → детальная. Второй markEnter видит prevPath !== null
    // и ставит отметку — как в реальном приложении (хук на детальной странице).
    markEnter('/blog/posts');
    markEnter('/blog/posts/7');
    expect(hasInAppHistory()).toBe(true);

    render(<BackButton fallbackHref="/blog/posts" />);
    await userEvent.setup().click(screen.getByRole('button', { name: '← назад' }));

    expect(back).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it('отметки нет (прямой заход, чистый sessionStorage) → push(fallbackHref), back не зовётся', async () => {
    // После __testReset prevPath === null: первый markEnter отметки НЕ даёт —
    // так же ведёт себя модуль после full reload (deep link/login-redirect).
    markEnter('/blog/posts/7');
    expect(hasInAppHistory()).toBe(false);

    render(<BackButton fallbackHref="/blog/posts?blog=main" />);
    await userEvent.setup().click(screen.getByRole('button', { name: '← назад' }));

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/blog/posts?blog=main');
    expect(back).not.toHaveBeenCalled();
    // fallback-push = пришли извне: отметка очищена, следующий заход честен.
    expect(hasInAppHistory()).toBe(false);
  });

  it('fallbackHref пинится per-page (prop, не хардкод внутри компонента)', async () => {
    render(<BackButton fallbackHref="/rag/chat" />);
    await userEvent.setup().click(screen.getByRole('button', { name: '← назад' }));

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/rag/chat');
  });

  it('kit-smoke: это button с видимым именем; кастомный лейбл сохраняет имя', () => {
    const btn = render(<BackButton fallbackHref="/chat" />).getByRole('button', {
      name: '← назад',
    });
    expect(btn).toBeVisible();
    expect(btn).toHaveAttribute('type', 'button');

    render(<BackButton fallbackHref="/chat" label="чаты" />);
    expect(screen.getByRole('button', { name: 'чаты' })).toBeVisible();
  });
});
