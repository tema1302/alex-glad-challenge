'use client';

// Toast (ТЗ §5.4, D4): глобальные уведомления вместо inline-блоков.
// Очередь, variants ok/err/info, auto-hide 4s, ручной dismiss, портал в body
// (z-toast). Провайдер монтируется в root layout; потребители — useToast().

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconCheck, IconX, IconWarning } from './icons';

type ToastVariant = 'ok' | 'err' | 'info';

interface ToastItem {
  id: number;
  variant: ToastVariant;
  text: string;
}

interface ToastApi {
  toast: (variant: ToastVariant, text: string) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);
const AUTO_HIDE_MS = 4000;

export function useToast(): ToastApi {
  // Фолбэк вне провайдера — no-op (компонент не падает в изолированных рендерах).
  return useContext(ToastCtx) ?? { toast: () => undefined };
}

const VARIANT_STYLES: Record<ToastVariant, { border: string; icon: ReactNode }> = {
  ok: { border: 'border-ok/50 text-ok', icon: <IconCheck /> },
  err: { border: 'border-err/50 text-err', icon: <IconWarning /> },
  info: { border: 'border-line-strong text-dim', icon: <IconCheck /> },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [mounted, setMounted] = useState(false);
  const nextId = useRef(1);

  useEffect(() => setMounted(true), []);

  const dismiss = useCallback((id: number) => {
    setItems((q) => q.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (variant: ToastVariant, text: string) => {
      const id = nextId.current++;
      setItems((q) => [...q.slice(-4), { id, variant, text }]);
      setTimeout(() => dismiss(id), AUTO_HIDE_MS);
    },
    [dismiss],
  );

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      {mounted &&
        createPortal(
          <div
            aria-live="polite"
            className="pointer-events-none fixed bottom-4 right-4 z-toast flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2"
          >
            {items.map((t) => {
              const v = VARIANT_STYLES[t.variant];
              return (
                <div
                  key={t.id}
                  role={t.variant === 'err' ? 'alert' : 'status'}
                  className={`anim-pop pointer-events-auto flex items-start gap-2 rounded-lg border bg-surface p-3 shadow-pop ${v.border}`}
                >
                  <span aria-hidden="true" className="mt-0.5 shrink-0">
                    {v.icon}
                  </span>
                  <p className="min-w-0 flex-1 break-words text-sm leading-snug text-ink">{t.text}</p>
                  <button
                    type="button"
                    aria-label="Скрыть уведомление"
                    onClick={() => dismiss(t.id)}
                    className="-mr-1 -mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-dim transition-colors duration-fast hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim"
                  >
                    <IconX />
                  </button>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </ToastCtx.Provider>
  );
}
