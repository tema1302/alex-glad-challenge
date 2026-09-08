import type { ReactNode } from 'react';
import { SectionLabel } from './SectionLabel';

// SectionHead (ТЗ §5.3): единый паттерн заголовка страницы админки —
// eyebrow-лейбл (SectionLabel) + sans-h1 (человеческий голос, без caps) +
// description + actions slot. mono остаётся только для данных.

export function SectionHead({
  code,
  title,
  description,
  actions,
}: {
  code: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <SectionLabel>{code}</SectionLabel>
        <h1 className="font-sans text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-dim">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </section>
  );
}
