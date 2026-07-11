import { type ReactNode } from 'react';

export function Tile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2">
      <div className="font-mono text-xs uppercase tracking-wider text-dim">{label}</div>
      <div className="mt-1 font-mono text-lg text-ink">{value}</div>
      {hint ? <div className="mt-0.5 font-mono text-[11px] text-dim">{hint}</div> : null}
    </div>
  );
}
