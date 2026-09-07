'use client';

// Dialog (ТЗ §5.4): модальное окно, заменяет все window.confirm.
// Контракт: role="dialog", aria-modal, focus-trap (Tab зациклен), Esc = cancel,
// клик по подложке = cancel, при закрытии фокус возвращается инициатору.
// Портал в body (z-dialog); tone=danger — красная шапка. Мобильные: bottom-sheet,
// ≥sm: центр экрана.

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconX } from './icons';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  open,
  onClose,
  title,
  tone = 'default',
  children,
  footer,
  closeLabel = 'Закрыть',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  tone?: 'default' | 'danger';
  children: ReactNode;
  footer?: ReactNode;
  closeLabel?: string;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Фокус в первый контрол при открытии; возврат фокуса инициатору при закрытии.
  useEffect(() => {
    if (!open) return;
    const initiator = document.activeElement as HTMLElement | null;
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panelRef.current)?.focus();
    return () => initiator?.focus();
  }, [open]);

  // Блокировка скролла фона на время диалога.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!items || items.length === 0) return;
      const list = Array.from(items);
      const idx = list.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && (idx <= 0)) {
        e.preventDefault();
        list[list.length - 1].focus();
      } else if (!e.shiftKey && idx === list.length - 1) {
        e.preventDefault();
        list[0].focus();
      }
    },
    [onClose],
  );

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-dialog flex items-end justify-center p-4 sm:items-center">
      <div
        className="absolute inset-0 bg-bg/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`anim-pop relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-lg border bg-surface p-5 shadow-pop ${
          tone === 'danger' ? 'border-t-2 border-t-err border-line' : 'border-line'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <h2
            id={titleId}
            className={`font-mono text-sm font-semibold uppercase tracking-wide ${
              tone === 'danger' ? 'text-err' : 'text-ink'
            }`}
          >
            {title}
          </h2>
          <button
            type="button"
            aria-label={closeLabel}
            onClick={onClose}
            className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-dim transition-colors duration-fast hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim"
          >
            <IconX />
          </button>
        </div>
        <div className="mt-3 text-sm leading-relaxed text-dim">{children}</div>
        {footer ? <div className="mt-5 flex flex-wrap justify-end gap-2">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
