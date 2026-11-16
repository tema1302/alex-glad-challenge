'use client';

// Кнопка-триггер палитры в шапке: диспатчит CustomEvent, который слушает
// CommandPalette. Отдельный клиентский компонент, потому что Nav — server.
import { IconSearch } from '../ui/icons';
import { PALETTE_OPEN_EVENT } from './CommandPalette';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

export function PaletteButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(PALETTE_OPEN_EVENT))}
      aria-label="Открыть быструю навигацию"
      className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-line-strong px-2 py-1 text-xs text-dim transition-colors duration-fast hover:border-accent-dim hover:text-ink sm:min-h-[32px] ${FOCUS}`}
    >
      <IconSearch className="h-4 w-4 sm:hidden" />
      <span className="hidden sm:inline">Поиск</span>
      <kbd className="hidden rounded border border-line bg-surface-2 px-1 font-mono text-[10px] text-dim sm:inline">
        Ctrl K
      </kbd>
    </button>
  );
}
