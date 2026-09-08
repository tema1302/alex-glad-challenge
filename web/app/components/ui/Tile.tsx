import { type ReactNode } from 'react';

// Tile: метрика — label человеческим голосом (sans), значение — данные (mono
// tabular-nums). icon — опциональный слот перед лейблом (не обязателен к использованию).

export function Tile({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 shadow-panel">
      <div className="flex items-center gap-1.5 font-sans text-xs text-dim">
        {icon ? <span aria-hidden="true" className="shrink-0">{icon}</span> : null}
        {label}
      </div>
      <div className="mt-1 font-mono text-lg tabular-nums text-ink">{value}</div>
      {hint ? <div className="mt-0.5 font-mono text-[11px] tabular-nums text-dim">{hint}</div> : null}
    </div>
  );
}
