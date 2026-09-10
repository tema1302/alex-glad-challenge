// @vitest-environment jsdom
// ProgressPanel: уровень/XP из localStorage, живое обновление по reportResult,
// раскрытие достижений, шеринг (клипборд + t.me/share), устойчивость к мусору.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProgressPanel } from '../../app/components/arcade/ProgressPanel';
import { reportResult } from '../../app/components/arcade/use-progress';
import { ACHIEVEMENT_DEFS } from '../../app/components/arcade/progress';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('ProgressPanel', () => {
  it('старт: уровень 1, 0 XP, счётчик достижений 0/7', () => {
    render(<ProgressPanel />);
    expect(screen.getByText('ур. 1')).not.toBeNull();
    expect(screen.getByText('Новичок витрины')).not.toBeNull();
    expect(screen.getByText(/0 XP/)).not.toBeNull();
    expect(screen.getByText('Достижения 0/7')).not.toBeNull();
  });

  it('reportResult обновляет панель на лету (CustomEvent-подписка)', () => {
    render(<ProgressPanel />);
    act(() => {
      reportResult({ game: 'sim', score: 1, total: 1 });
    });
    expect(screen.getByText(/25 XP/)).not.toBeNull();
    // Выпуск в симуляторе открывает и «Первый раунд», и «Главред» — 2 из 7.
    expect(screen.getByText('Достижения 2/7')).not.toBeNull();
  });

  it('раскрытый список: 7 достижений, закрытые с подсказкой, открытые — «открыто»', () => {
    render(<ProgressPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Достижения/ }));
    for (const a of ACHIEVEMENT_DEFS) {
      expect(screen.getByText(a.title)).not.toBeNull();
      expect(screen.getByText(a.hint)).not.toBeNull();
    }
    act(() => {
      reportResult({ game: 'quiz', score: 8, total: 8 });
    });
    // Открылись first-steps и sharp-eye; их подсказки сменились на «открыто».
    expect(screen.getAllByText('открыто')).toHaveLength(2);
    expect(screen.getByText('Достижения 2/7')).not.toBeNull();
  });

  it('«Поделиться» пишет карточку профиля в клипборд и открывает t.me/share', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    render(<ProgressPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Поделиться' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain('Мой уровень в аркаде витрины');
    expect(text).toContain('XP');
    expect(open).toHaveBeenCalledTimes(1);
    expect(String(open.mock.calls[0][0])).toContain('https://t.me/share/url?');
  });

  it('валидный прогресс из localStorage применяется при старте', () => {
    window.localStorage.setItem(
      'arcade.progress.v1',
      JSON.stringify({ xp: 120, plays: { quiz: 3 }, bests: { quiz: 8 }, achievements: ['first-steps', 'sharp-eye', 'rising-star'] }),
    );
    render(<ProgressPanel />);
    expect(screen.getByText(/120 XP/)).not.toBeNull();
    expect(screen.getByText('Достижения 3/7')).not.toBeNull();
  });

  it('мусор в localStorage не роняет панель — отображается нулевой прогресс', () => {
    window.localStorage.setItem('arcade.progress.v1', '{сломанный json');
    render(<ProgressPanel />);
    expect(screen.getByText(/0 XP/)).not.toBeNull();

    window.localStorage.clear();
    window.localStorage.setItem(
      'arcade.progress.v1',
      JSON.stringify({ xp: 'много', achievements: ['не-известный-id', 'sharp-eye'] }),
    );
    cleanup();
    render(<ProgressPanel />);
    expect(screen.getByText(/0 XP/)).not.toBeNull();
    // неизвестные достижения отфильтрованы, валидный засчитан
    expect(screen.getByText('Достижения 1/7')).not.toBeNull();
  });

  it('у XP-полосы корректная aria-разметка прогресса', () => {
    render(<ProgressPanel />);
    const bar = screen.getByRole('progressbar', { name: 'Прогресс до следующего уровня' });
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(Number(bar.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(0);
  });

  it('максимальный уровень: полоса заполнена, подпись «максимум»', () => {
    window.localStorage.setItem(
      'arcade.progress.v1',
      JSON.stringify({ xp: 500, plays: {}, bests: {}, achievements: [] }),
    );
    render(<ProgressPanel />);
    expect(screen.getByText(/максимум/)).not.toBeNull();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  });
});
