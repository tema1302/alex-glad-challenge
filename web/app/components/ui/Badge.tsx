import { type ReactNode } from 'react';

// Badge (ТЗ §5.4): статусы draft/published/error + универсальные тона.
// Для табличек блогов и outbox — statusBadge() с готовой семантикой.

type Tone = 'neutral' | 'dim' | 'ok' | 'warn' | 'err' | 'accent';

const TONES: Record<Tone, string> = {
  neutral: 'border-line-strong bg-surface-2 text-dim',
  dim: 'border-line bg-surface text-dim',
  ok: 'border-ok/40 bg-ok/10 text-ok',
  warn: 'border-warn/40 bg-warn/10 text-warn',
  err: 'border-err/40 bg-err/10 text-err',
  accent: 'border-accent/40 bg-accent/10 text-accent',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wide ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function statusBadge(status: 'draft' | 'published' | 'error'): ReactNode {
  if (status === 'published') return <Badge tone="ok">published</Badge>;
  if (status === 'error') return <Badge tone="err">error</Badge>;
  return <Badge tone="dim">draft</Badge>;
}
