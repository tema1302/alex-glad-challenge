'use client';

// Командная палитра (⌘K / Ctrl+K): быстрая навигация по всем разделам.
// Открывается с клавиатуры, из кнопки PaletteButton (CustomEvent) и кликом по
// фону закрывается. Гость и админ получают разные наборы команд (isAdmin из
// layout). Навигация: Enter/клик — router.push, внешние ссылки — новая вкладка.
// ARIA: dialog + listbox/option с aria-activedescendant для скринридеров.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { rankByQuery } from '../../../lib/shared/fuzzy';
import { buildPaletteItems, type PaletteItem } from './palette-items';

export const PALETTE_OPEN_EVENT = 'palette:open';

const MAX_RESULTS = 9;

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

export function CommandPalette({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listId = 'command-palette-listbox';

  const items = useMemo(() => buildPaletteItems(isAdmin), [isAdmin]);
  const results = useMemo(
    () => rankByQuery(query, items, (i) => `${i.label} ${i.hint ?? ''}`).slice(0, MAX_RESULTS),
    [query, items],
  );

  const close = useCallback((): void => {
    setOpen(false);
    setQuery('');
    setActive(0);
  }, []);

  const openPalette = useCallback((): void => {
    setQuery('');
    setActive(0);
    setOpen(true);
  }, []);

  // Глобальные клавиши и событие кнопки-триггера.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery('');
        setActive(0);
      }
    };
    const onOpen = (): void => openPalette();
    window.addEventListener('keydown', onKey);
    window.addEventListener(PALETTE_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(PALETTE_OPEN_EVENT, onOpen);
    };
  }, [openPalette]);

  // Открытая палитра: фокус в поле, Esc — закрыть.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const go = useCallback(
    (item: PaletteItem): void => {
      close();
      if (item.external) {
        window.open(item.href, '_blank', 'noopener,noreferrer');
      } else {
        router.push(item.href);
      }
    },
    [close, router],
  );

  if (!open) return null;

  const activeId = active >= 0 && active < results.length ? `${listId}-opt-${active}` : undefined;

  return (
    <div
      className="fixed inset-0 z-dialog flex items-start justify-center bg-panel/50 p-4 pt-[12vh] backdrop-blur-sm"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Быстрая навигация"
        className="w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter' && results[active]) {
              e.preventDefault();
              go(results[active]);
            }
          }}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-label="Поиск раздела"
          placeholder="Куда перейти? Введите название…"
          className={`w-full border-b border-line bg-surface px-4 py-3.5 text-sm text-ink placeholder:text-dim ${FOCUS}`}
        />

        <ul id={listId} role="listbox" aria-label="Разделы" className="max-h-[50vh] overflow-y-auto p-1.5">
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-dim" role="status">
              Ничего не нашлось — попробуйте другое слово.
            </li>
          )}
          {results.map((item, i) => (
            <li
              key={item.id}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseMove={() => setActive(i)}
              onClick={() => go(item)}
              className={`flex cursor-pointer items-baseline gap-2 rounded-lg px-3 py-2.5 text-sm ${
                i === active ? 'bg-accent/15 text-ink' : 'text-ink'
              }`}
            >
              <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
              {item.hint && (
                <span className="shrink-0 font-mono text-[11px] text-dim">{item.hint}</span>
              )}
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-4 border-t border-line px-4 py-2 font-mono text-[11px] text-dim">
          <span>↑↓ — выбор</span>
          <span>Enter — перейти</span>
          <span>Esc — закрыть</span>
        </div>
      </div>
    </div>
  );
}
