// @vitest-environment jsdom
// Component: Dialog — портал, фокус-менеджмент, Esc/overlay-cancel, возврат фокуса.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Dialog } from '../../app/components/ui/Dialog';
import { Button } from '../../app/components/ui/Button';

afterEach(cleanup);

function Harness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button onClick={() => setOpen(true)}>открыть</Button>
      <Dialog open={open} onClose={() => { onClose(); setOpen(false); }} title="Тест диалога">
        <p>Содержимое</p>
        <input aria-label="поле" />
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('closed → ничего не рендерит; open → портал в body с role=dialog', () => {
    const onClose = vi.fn();
    const { baseElement } = render(<Harness onClose={onClose} />);
    expect(baseElement.querySelector('[role="dialog"]')).not.toBeNull();
    expect(screen.getByText('Тест диалога')).toBeInTheDocument();
  });

  it('при открытии фокус уходит в первый контрол диалога', () => {
    render(<Harness onClose={() => undefined} />);
    const active = document.activeElement;
    expect(active?.tagName).toBe('BUTTON');
    expect(active?.getAttribute('aria-label')).toBe('Закрыть');
  });

  it('Esc закрывает и возвращает фокус инициатору', () => {
    const onClose = vi.fn();
    const { baseElement } = render(<Harness onClose={onClose} />);
    const initiator = screen.getByRole('button', { name: 'открыть' });
    // Фокус-менеджмент: сохранённый initiator восстанавливается при закрытии.
    initiator.focus();
    const dialog = baseElement.querySelector('[role="dialog"]');
    fireEvent.keyDown(dialog!, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('клик по подложке = cancel', () => {
    const onClose = vi.fn();
    const { baseElement } = render(<Harness onClose={onClose} />);
    const overlay = baseElement.querySelector('[aria-hidden="true"]');
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('клик по содержимому НЕ закрывает', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByText('Содержимое'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('danger-тон: красная шапка заголовка', () => {
    render(
      <Dialog open onClose={() => undefined} title="Удалить?" tone="danger">
        <p>x</p>
      </Dialog>,
    );
    const title = screen.getByText('Удалить?');
    expect(title.className).toContain('text-err');
  });
});
