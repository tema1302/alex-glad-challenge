'use client';

// Textarea (ТЗ §5.4): autosize (cap 12 рядов), опциональный счётчик n/max
// (warn-цвет с warnAt). Используется в TG-компоузере и редакторе постов.
// Контролируемый: value + onValueChange (id/aria пробрасывает Field).

import { useEffect, useRef, type RefObject, type TextareaHTMLAttributes } from 'react';

const CAP_PX = 280; // ≈12 рядов text-xs

// Прочие нативные атрибуты (id, aria-*, name) пробрасываются как есть —
// Field инжектит id/aria-describedby/aria-invalid через cloneElement.
export function Textarea({
  value,
  onValueChange,
  max,
  warnAt,
  rows = 4,
  placeholder,
  disabled,
  inputRef,
  className = '',
  ...rest
}: {
  value: string;
  onValueChange: (v: string) => void;
  max?: number;
  warnAt?: number;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
  /** Наружный ref на textarea — для выделений/курсора (markup-помощник компоузера). */
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  className?: string;
} & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const innerRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? innerRef;

  // Autosize: высота = scrollHeight, но не выше CAP (дальше — внутренний скролл).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, CAP_PX)}px`;
    el.style.overflowY = el.scrollHeight > CAP_PX ? 'auto' : 'hidden';
  }, [value]);

  const over = max !== undefined && value.length > max;
  const warn = !over && max !== undefined && warnAt !== undefined && value.length >= warnAt;

  return (
    <div className="space-y-1">
      <textarea
        {...rest}
        ref={ref}
        rows={rows}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-full resize-none rounded-md border bg-surface-2 p-2.5 font-mono text-xs leading-relaxed text-ink placeholder:text-dim transition-colors duration-fast focus-visible:border-accent-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim disabled:opacity-50 ${
          over ? 'border-err/60' : 'border-line-strong'
        } ${className}`}
      />
      {max !== undefined && (
        <div
          className={`text-right font-mono text-[11px] tabular-nums ${
            over ? 'text-err' : warn ? 'text-warn' : 'text-dim'
          }`}
        >
          {value.length} / {max}
        </div>
      )}
    </div>
  );
}
