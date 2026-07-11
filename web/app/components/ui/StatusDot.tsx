import { type ReactNode } from 'react';

type Status = 'ok' | 'warn' | 'err' | 'off';

const MAP: Record<Status, { dot: string; text: string; label: string }> = {
  ok: { dot: 'bg-ok', text: 'text-ok', label: 'ok' },
  warn: { dot: 'bg-warn', text: 'text-warn', label: 'warn' },
  err: { dot: 'bg-err', text: 'text-err', label: 'err' },
  off: { dot: 'bg-dim', text: 'text-dim', label: 'off' },
};

export function StatusDot({ status, label }: { status: Status; label?: ReactNode }) {
  const m = MAP[status];
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs">
      <span className={`inline-block h-2 w-2 rounded-full ${m.dot}`} />
      <span className={m.text}>{label ?? m.label}</span>
    </span>
  );
}
