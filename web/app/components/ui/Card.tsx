import { type ReactNode } from 'react';
import { IconChevronRight } from './icons';

// Card (ТЗ §5.4): label + actions slot + tone default/warn/danger.
// tone — семантика содержимого (LANDMINE/ошибки → danger, внешние эффекты → warn).
// variant — аффорданс интерактивности: static (default) — плоская инфо-карточка
// без hover; interactive — hover-lift + акцент-бордер + (arrow) шеврон: «можно
// нажать». Все пропсы опциональны с дефолтами — старые вызовы валидны.

type Tone = 'default' | 'warn' | 'danger';

const TONES: Record<Tone, string> = {
  default: 'border-line bg-surface',
  warn: 'border-warn/40 bg-warn/10',
  danger: 'border-err/40 bg-err/10',
};

const INTERACTIVE =
  'group cursor-pointer transition-all duration-base ease-system hover:-translate-y-0.5 hover:border-accent-dim hover:shadow-lift focus-visible:ring-2 focus-visible:ring-accent-dim';

export function Card({
  label,
  actions,
  tone = 'default',
  variant = 'static',
  arrow = false,
  children,
  className = '',
}: {
  label?: string;
  actions?: ReactNode;
  tone?: Tone;
  variant?: 'static' | 'interactive';
  arrow?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const interactive = variant === 'interactive';
  return (
    <section
      className={`relative rounded-xl border p-4 shadow-panel ${TONES[tone]} ${
        interactive ? INTERACTIVE : ''
      } ${className}`}
    >
      {label || actions ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          {label ? (
            <div role="heading" aria-level={3} className="font-sans text-xs font-semibold uppercase tracking-wider text-dim">
              {label}
            </div>
          ) : (
            <div />
          )}
          {actions}
        </div>
      ) : null}
      {interactive && arrow ? (
        <IconChevronRight className="absolute right-3 top-3 text-accent transition-transform duration-base ease-system group-hover:translate-x-0.5" />
      ) : null}
      {children}
    </section>
  );
}
