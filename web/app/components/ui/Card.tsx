import { type ReactNode } from 'react';

// Card (ТЗ §5.4): label + actions slot + tone default/warn/danger.
// tone — семантика содержимого (LANDMINE/ошибки → danger, внешние эффекты → warn).

type Tone = 'default' | 'warn' | 'danger';

const TONES: Record<Tone, string> = {
  default: 'border-line bg-surface',
  warn: 'border-warn/40 bg-warn/10',
  danger: 'border-err/40 bg-err/10',
};

export function Card({
  label,
  actions,
  tone = 'default',
  children,
  className = '',
}: {
  label?: string;
  actions?: ReactNode;
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border p-4 shadow-panel ${TONES[tone]} ${className}`}>
      {label || actions ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          {label ? (
            <div role="heading" aria-level={3} className="font-mono text-xs uppercase tracking-wider text-dim">
              // {label}
            </div>
          ) : (
            <div />
          )}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}
