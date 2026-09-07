import { type ButtonHTMLAttributes, type ReactNode } from 'react';

// Button (дизайн-система 2.0, ТЗ §5.4): variants primary/ghost/danger, sizes sm/md,
// loading (spinner + блокировка), icon-режим. Единый focus-ring (accent-dim);
// min-height 36 desktop / 44 на тач-брейкпойнтах (max-md).

type Variant = 'primary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:bg-accent/90',
  ghost: 'border border-line-strong text-dim hover:border-accent-dim hover:text-ink',
  danger: 'border border-err/60 text-err hover:bg-err/10',
};

const SIZES: Record<Size, string> = {
  sm: 'min-h-[32px] max-md:min-h-[40px] gap-1.5 px-2.5 py-1 text-xs',
  md: 'min-h-[36px] max-md:min-h-[44px] gap-2 px-3.5 py-1.5 text-sm',
};

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  /** Иконочный режим: квадратная кнопка только с иконкой (пара — Tooltip). */
  square?: boolean;
}

export function Button({
  variant = 'ghost',
  size = 'md',
  loading = false,
  icon,
  square = false,
  className = '',
  type = 'button',
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center rounded-md font-medium transition-colors duration-fast ease-system ${SIZES[size]} ${VARIANTS[variant]} ${FOCUS} ${
        square ? 'aspect-square !px-0' : ''
      } disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...rest}
    >
      {loading ? (
        <span aria-hidden="true" className="spin inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent" />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}
