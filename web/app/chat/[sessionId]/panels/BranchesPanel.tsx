// Branching-панель: дерево веток + checkpoint + switch. web P2b.
// 'use client'; рендерится только для strategy=branching (условие — в page.tsx).
'use client';
import { useState } from 'react';
import { usePanelView } from './usePanelView';

interface BranchItem { id: number; label: string; parentId: number | null; active: boolean; messageCount: number; }
interface BranchView { branches: BranchItem[]; activeId: number; }

export function BranchesPanel({ sessionId }: { sessionId: string }) {
  const { view, error, busy, post } = usePanelView<BranchView>(`/api/chat/${sessionId}/branch`);
  const [label, setLabel] = useState('');

  if (!view) return <p className="text-xs text-dim">branches: загрузка…</p>;

  return (
    <div className="space-y-2">
      <p className="text-xs text-dim">
        Активная ветка определяет, какая история подаётся в контекст LLM и куда пишутся новые реплики.
      </p>
      <ul className="space-y-1">
        {view.branches.map((b) => (
          <li
            key={b.id}
            className={
              'flex cursor-pointer items-center justify-between gap-2 rounded border px-2 py-1 text-sm ' +
              (b.active
                ? 'border-accent bg-accent/10'
                : 'border-line hover:border-line-strong')
            }
            title={b.parentId === null ? 'корень' : `родитель: branch-${b.parentId}`}
          >
            <span
              onClick={() => { if (!b.active && !busy) void post({ action: 'switch', id: b.id }); }}
              className="flex-1"
            >
              <span className="font-mono text-dim">#{b.id}</span>{' '}
              {b.label}
              {b.active && <span className="ml-2 text-xs text-accent">● активна</span>}
            </span>
            <span className="text-xs text-dim tabular-nums">{b.messageCount} сообщ.</span>
          </li>
        ))}
      </ul>
      <div className="flex gap-1">
        <input
          className="flex-1 rounded border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink placeholder:text-dim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          placeholder="метка (опц.)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          disabled={busy}
        />
        <button
          className="rounded border border-line-strong px-2 py-1 text-xs text-dim transition-colors hover:text-ink disabled:opacity-50"
          disabled={busy}
          onClick={() => { void post({ action: 'checkpoint', label: label.trim() || undefined }); setLabel(''); }}
        >
          + checkpoint (ветка от активной)
        </button>
      </div>
      {error && <p className="text-xs text-err">{error}</p>}
    </div>
  );
}
