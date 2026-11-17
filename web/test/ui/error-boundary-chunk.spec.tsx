// @vitest-environment jsdom
// Регресс на «Глобальный сбой»: ChunkLoadError (например, отсутствующий чанк
// 8115 после редеплоя) должен восстанавливаться жёсткой перезагрузкой, а не
// тупиковым reset() сегмента. Повтор в окне TTL — понятный fallback без цикла.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import GlobalError from '../../app/global-error';
import SegmentError from '../../app/error';
import { claimChunkReload, isChunkLoadError } from '../../lib/shared/chunkRecovery';

const reload = vi.fn();

// jsdom 30 делает Location.reload non-configurable — подменяем весь location.
beforeEach(() => {
  reload.mockReset();
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { reload, search: '', assign: vi.fn() },
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

function chunkError(): Error {
  return new Error('Loading chunk 8115 failed. (error: https://example.test/8115.js)');
}

describe('GlobalError при ChunkLoadError', () => {
  it('вызывает window.location.reload() — reset() сегмента не обновляет HTML', async () => {
    await act(async () => {
      render(<GlobalError error={chunkError()} reset={vi.fn()} />);
    });

    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem('web:chunk-reload-at')).not.toBeNull();
  });

  it('второй отказ в окне TTL не вызывает повторный reload и показывает fallback', async () => {
    await act(async () => {
      render(<GlobalError error={chunkError()} reset={vi.fn()} />);
    });
    expect(reload).toHaveBeenCalledTimes(1);

    cleanup();
    await act(async () => {
      render(<GlobalError error={chunkError()} reset={vi.fn()} />);
    });

    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Обновите страницу позже/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    });
    expect(reload).toHaveBeenCalledTimes(2); // пользовательский ретрай — не цикл
  });

  it('обычная ошибка: reload не вызывается, работает reset()', async () => {
    const reset = vi.fn();
    await act(async () => {
      render(<GlobalError error={new Error('range failed')} reset={reset} />);
    });

    expect(reload).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    });
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe('Error (сегмент)', () => {
  it('тоже перезагружает документ при ChunkLoadError', async () => {
    await act(async () => {
      render(<SegmentError error={chunkError()} reset={vi.fn()} />);
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('chunkRecovery', () => {
  it('распознаёт ChunkLoadError по name и по тексту, но не обычные ошибки', () => {
    const named = new Error('boom');
    named.name = 'ChunkLoadError';
    expect(isChunkLoadError(named)).toBe(true);
    expect(isChunkLoadError(new Error('Loading CSS chunk 12 failed.'))).toBe(true);
    expect(isChunkLoadError('Loading chunk 8115 failed')).toBe(false);
    expect(isChunkLoadError(new Error('range failed'))).toBe(false);
  });

  it('без storage не даёт добро на reload (privacy mode / SSR)', () => {
    expect(claimChunkReload(chunkError(), null)).toBe(false);
    expect(claimChunkReload(chunkError(), undefined)).toBe(false);
  });
});
