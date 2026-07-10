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

  if (!view) return <p className="text-xs text-neutral-400">branches: загрузка…</p>;

  return (
    <div className="space-y-2">
      <p className="text-xs text-neutral-400">
        Активная ветка определяет, какая история подаётся в контекст LLM и куда пишутся новые реплики.
      </p>
      <ul className="space-y-1">
        {view.branches.map((b) => (
          <li
            key={b.id}
            className={
              'flex cursor-pointer items-center justify-between gap-2 rounded border px-2 py-1 text-sm ' +
              (b.active
                ? 'border-accent bg-accent/10 dark:bg-accent/20'
                : 'border-neutral-200 hover:border-neutral-400 dark:border-neutral-700')
            }
            title={b.parentId === null ? 'корень' : `родитель: branch-${b.parentId}`}
          >
            <span
              onClick={() => { if (!b.active && !busy) void post({ action: 'switch', id: b.id }); }}
              className="flex-1"
            >
              <span className="font-mono text-neutral-500">#{b.id}</span>{' '}
              {b.label}
              {b.active && <span className="ml-2 text-xs text-accent">● активна</span>}
            </span>
            <span className="text-xs text-neutral-400 tabular-nums">{b.messageCount} сообщ.</span>
          </li>
        ))}
      </ul>
      <div className="flex gap-1">
        <input
          className="flex-1 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          placeholder="метка (опц.)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          disabled={busy}
        />
        <button
          className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-neutral-700"
          disabled={busy}
          onClick={() => { void post({ action: 'checkpoint', label: label.trim() || undefined }); setLabel(''); }}
        >
          + checkpoint (ветка от активной)
        </button>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
