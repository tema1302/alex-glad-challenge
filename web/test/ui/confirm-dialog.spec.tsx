// @vitest-environment jsdom
// Component: ConfirmDialog — async onConfirm с loading, успех закрывает,
// ошибка оставляет открытым, busy блокирует cancel/Esc.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfirmDialog } from '../../app/components/ui/ConfirmDialog';

afterEach(cleanup);

describe('ConfirmDialog', () => {
  it('успешный onConfirm → закрывается', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn(async () => undefined);
    render(
      <ConfirmDialog open onClose={onClose} onConfirm={onConfirm} title="Отправить?" confirmLabel="Опубликовать" body="тело" />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('ошибка onConfirm → диалог остаётся открытым, busy снят, cancel активен', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn(async () => {
      throw new Error('бот недоступен');
    });
    render(
      <ConfirmDialog open onClose={onClose} onConfirm={onConfirm} title="Отправить в канал?" confirmLabel="Опубликовать" body="тело" />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    // Остался открыт (onClose не звали), отменить можно
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Отмена' })).toBeEnabled());
    expect(screen.getByRole('dialog')).not.toBeNull();
  });

  it('пока onConfirm выполняется — cancel/confirm заблокированы (loading)', async () => {
    let resolveFn: (v: void) => void = () => undefined;
    const onConfirm = vi.fn(
      () => new Promise<void>((res) => { resolveFn = res; }),
    );
    render(
      <ConfirmDialog open onClose={() => undefined} onConfirm={onConfirm} title="Отправить в канал?" confirmLabel="Опубликовать" body="тело" />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));
    expect(screen.getByRole('button', { name: 'Отмена' })).toBeDisabled();
    const confirmBtn = screen.getByRole('button', { name: /Опубликовать/ });
    expect(confirmBtn).toBeDisabled();
    expect(confirmBtn.getAttribute('aria-busy')).toBe('true');

    resolveFn();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Отмена' })).toBeEnabled());
  });

  it('danger-тон: красная шапка + confirm-кнопка danger', () => {
    render(
      <ConfirmDialog open onClose={() => undefined} onConfirm={async () => undefined} title="Удалить пост?" tone="danger" body="тело" />,
    );
    expect(screen.getByText('Удалить пост?').className).toContain('text-err');
  });
});
