import { type ReactNode } from 'react';

// EmptyState (ТЗ §5.4): иконка + текст + action. Для всех пустых списков.

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line bg-surface/50 px-6 py-10 text-center">
      {icon ? <div aria-hidden="true" className="text-dim">{icon}</div> : null}
      <p className="font-mono text-sm text-ink">{title}</p>
      {hint ? <p className="max-w-sm text-xs leading-relaxed text-dim">{hint}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
