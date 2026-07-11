import { type ReactNode } from 'react';

export function Card({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-line bg-surface p-4">
      {label ? (
        <div role="heading" aria-level={3} className="mb-3 font-mono text-xs uppercase tracking-wider text-dim">// {label}</div>
      ) : null}
      {children}
    </section>
  );
}
