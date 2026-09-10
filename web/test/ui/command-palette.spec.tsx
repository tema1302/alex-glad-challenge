// @vitest-environment jsdom
// CommandPalette: открытие (кнопка/Ctrl+K), поиск, клавиатура, навигация,
// разные наборы для гостя и админа, внешние ссылки.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CommandPalette } from '../../app/components/palette/CommandPalette';
import { PaletteButton } from '../../app/components/palette/PaletteButton';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

afterEach(() => {
  cleanup();
  push.mockClear();
  vi.restoreAllMocks();
});

function keyK(ctrl = true): void {
  fireEvent.keyDown(window, { key: 'k', ctrlKey: ctrl, metaKey: false, cancelable: true });
}

describe('CommandPalette — открытие и закрытие', () => {
  it('до открытия ничего не рендерит', () => {
    const { container } = render(<CommandPalette isAdmin={false} />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('Ctrl+K открывает, повторное Ctrl+K закрывает', () => {
    render(<CommandPalette isAdmin={false} />);
    keyK();
    expect(screen.getByRole('dialog', { name: 'Быстрая навигация' })).not.toBeNull();
    keyK();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('кнопка-триггер открывает палитру через CustomEvent', () => {
    render(
      <>
        <PaletteButton />
        <CommandPalette isAdmin={false} />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Открыть быструю навигацию' }));
    expect(screen.getByRole('dialog')).not.toBeNull();
  });

  it('Esc закрывает палитру', () => {
    render(<CommandPalette isAdmin={false} />);
    keyK();
    fireEvent.keyDown(window, { key: 'Escape', cancelable: true });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('клик по фону закрывает, клик по диалогу — нет', () => {
    const { container } = render(<CommandPalette isAdmin={false} />);
    keyK();
    const backdrop = container.firstElementChild as HTMLElement;
    fireEvent.click(screen.getByRole('dialog')); // по самому окну — работает дальше
    expect(screen.queryByRole('dialog')).not.toBeNull();
    fireEvent.click(backdrop);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('CommandPalette — гость', () => {
  it('поиск находит публичное, ничего лишнего', () => {
    render(<CommandPalette isAdmin={false} />);
    keyK();
    const input = screen.getByRole('combobox', { name: 'Поиск раздела' });
    fireEvent.input(input, { target: { value: 'баз' } });
    const options = screen.getAllByRole('option');
    expect(options.some((o) => o.textContent?.includes('Спросить базу знаний'))).toBe(true);
  });

  it('админские разделы гостю не светятся даже поиском', () => {
    render(<CommandPalette isAdmin={false} />);
    keyK();
    fireEvent.input(screen.getByRole('combobox'), { target: { value: 'дайджест' } });
    expect(screen.getByText('Ничего не нашлось — попробуйте другое слово.')).not.toBeNull();
  });

  it('Enter ведёт на выбранную страницу через router.push', () => {
    render(<CommandPalette isAdmin={false} />);
    keyK();
    const input = screen.getByRole('combobox');
    fireEvent.input(input, { target: { value: 'тренажёр' } });
    fireEvent.keyDown(input, { key: 'Enter', cancelable: true });
    expect(push).toHaveBeenCalledWith('/harness');
    expect(screen.queryByRole('dialog')).toBeNull(); // после перехода палитра закрылась
  });

  it('внешняя ссылка на канал открывается в новой вкладке, не через router', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<CommandPalette isAdmin={false} />);
    keyK();
    const input = screen.getByRole('combobox');
    fireEvent.input(input, { target: { value: 'телеграм-канал' } });
    fireEvent.click(screen.getAllByRole('option')[0]);
    expect(push).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
    expect(String(open.mock.calls[0][0])).toContain('t.me');
  });
});

describe('CommandPalette — админ', () => {
  it('по запросу «дайджест» находит админский раздел блога', () => {
    render(<CommandPalette isAdmin />);
    keyK();
    fireEvent.input(screen.getByRole('combobox'), { target: { value: 'дайджест' } });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain('дайджест');
    expect(options[0].textContent).toContain('blog'); // группа в подзаголовке
  });

  it('стрелки двигают активный пункт, aria-activedescendant обновляется', () => {
    render(<CommandPalette isAdmin />);
    keyK();
    const input = screen.getByRole('combobox');
    const first = document.getElementById('command-palette-listbox-opt-0')!;
    expect(input.getAttribute('aria-activedescendant')).toBe(first.id);
    fireEvent.keyDown(input, { key: 'ArrowDown', cancelable: true });
    expect(input.getAttribute('aria-activedescendant')).toBe('command-palette-listbox-opt-1');
    fireEvent.keyDown(input, { key: 'ArrowUp', cancelable: true });
    fireEvent.keyDown(input, { key: 'ArrowUp', cancelable: true }); // выше нуля не уходит
    expect(input.getAttribute('aria-activedescendant')).toBe('command-palette-listbox-opt-0');
  });

  it('клик по пункту списка осуществляет переход', () => {
    render(<CommandPalette isAdmin />);
    keyK();
    fireEvent.input(screen.getByRole('combobox'), { target: { value: 'вит' } });
    const option = screen.getAllByRole('option')[0];
    expect(option.textContent).toContain('Витрина');
    fireEvent.click(option);
    expect(push).toHaveBeenCalledWith('/showcase');
  });

  it('без запроса показываются все команды (до 9 в списке)', () => {
    render(<CommandPalette isAdmin />);
    keyK();
    const options = screen.getAllByRole('option');
    expect(options.length).toBeGreaterThan(3);
    expect(options.length).toBeLessThanOrEqual(9);
  });
});
