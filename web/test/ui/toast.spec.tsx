// @vitest-environment jsdom
// Component: Toast — очередь через useToast, variants (role), dismiss, auto-hide 4s.
// ВАЖНО: useToast() вызывает ВНУТРЕННИЙ компонент (Inner), а не рендерящий
// провайдер Host — useContext видит только предков (как в реальном layout).
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ToastProvider, useToast } from '../../app/components/ui/Toast';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Host({ onClick }: { onClick: (toast: (v: 'ok' | 'err' | 'info', text: string) => void) => void }) {
  return (
    <ToastProvider>
      <Inner onClick={onClick} />
    </ToastProvider>
  );
}

function Inner({ onClick }: { onClick: (toast: (v: 'ok' | 'err' | 'info', text: string) => void) => void }) {
  const { toast } = useToast();
  return (
    <button type="button" onClick={() => onClick(toast)}>
      push
    </button>
  );
}

async function clickPush(name = 'push'): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
}

describe('ToastProvider', () => {
  it('ok-тост: role=status + текст + ручной dismiss', async () => {
    render(<Host onClick={(toast) => toast('ok', 'Опубликовано (message_id=42)')} />);
    await clickPush();

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Опубликовано (message_id=42)');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Скрыть уведомление' }));
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('err-тост: role=alert (скринридеры прочитают немедленно)', async () => {
    render(<Host onClick={(toast) => toast('err', 'Токен бота недействителен')} />);
    await clickPush();
    expect(screen.getByRole('alert')).toHaveTextContent('Токен бота недействителен');
  });

  it('auto-hide через 4с (fake timers)', async () => {
    vi.useFakeTimers();
    render(<Host onClick={(toast) => toast('info', 'сохранилось')} />);
    await clickPush();
    expect(screen.getByRole('status')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('несколько тостов живут одновременно (очередь)', async () => {
    render(
      <Host
        onClick={(toast) => {
          toast('ok', 'первый');
          toast('err', 'второй');
        }}
      />,
    );
    await clickPush();
    expect(screen.getByText('первый')).toBeInTheDocument();
    expect(screen.getByText('второй')).toBeInTheDocument();
  });
});
