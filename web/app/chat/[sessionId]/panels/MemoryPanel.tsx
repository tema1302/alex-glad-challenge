// Memory-панель: 3 слоя (long-term / task / working) + memory on/off. web P2b.
// 'use client'; импортирует только usePanelView (без core/).
'use client';
import { useState } from 'react';
import { usePanelView } from './usePanelView';

interface LongTermEntry { key: string; value: string; updatedAt: string; }
interface MemoryView {
  memoryEnabled: boolean;
  task: string | null;
  working: Record<string, string>;
  longTerm: LongTermEntry[];
}

export function MemoryPanel({ sessionId }: { sessionId: string }) {
  const { view, error, busy, post } = usePanelView<MemoryView>(`/api/chat/${sessionId}/memory`);
  const [ltKey, setLtKey] = useState('');
  const [ltVal, setLtVal] = useState('');
  const [taskDraft, setTaskDraft] = useState('');
  const [wfKey, setWfKey] = useState('');
  const [wfVal, setWfVal] = useState('');

  if (!view) return <p className="text-xs text-dim">memory: загрузка…</p>;

  const workingEntries = Object.entries(view.working).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={view.memoryEnabled}
          onChange={(e) => void post({ action: e.target.checked ? 'on' : 'off' })}
          disabled={busy}
        />
        memory mode (3 слоя в контексте LLM)
      </label>

      {/* Long-term */}
      <section>
        <h4 className="text-xs uppercase tracking-wide text-dim">Long-term (профиль/знания, глобально)</h4>
        <ul className="mt-1 space-y-1">
          {view.longTerm.length === 0 && <li className="text-xs text-dim">пусто</li>}
          {view.longTerm.map((e) => (
            <li key={e.key} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate"><span className="font-mono text-dim">{e.key}</span>: {e.value}</span>
              <button
                className="text-xs text-err hover:underline disabled:opacity-50"
                disabled={busy}
                onClick={() => void post({ action: 'forget', key: e.key })}
              >forget</button>
            </li>
          ))}
        </ul>
        <div className="mt-1 flex gap-1">
          <input className="flex-1 rounded border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink placeholder:text-dim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent" placeholder="ключ" value={ltKey} onChange={(e) => setLtKey(e.target.value)} disabled={busy} />
          <input className="flex-1 rounded border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink placeholder:text-dim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent" placeholder="значение" value={ltVal} onChange={(e) => setLtVal(e.target.value)} disabled={busy} />
          <button
            className="rounded border border-line-strong px-2 py-1 text-xs text-dim transition-colors hover:text-ink disabled:opacity-50"
            disabled={busy || !ltKey.trim()}
            onClick={() => { void post({ action: 'remember', key: ltKey.trim(), value: ltVal }); setLtKey(''); setLtVal(''); }}
          >remember</button>
        </div>
      </section>

      {/* Task */}
      <section>
        <h4 className="text-xs uppercase tracking-wide text-dim">Task (текущая задача)</h4>
        <p className="mt-1 text-sm">{view.task ?? <span className="text-dim">нет</span>}</p>
        <div className="mt-1 flex gap-1">
          <input className="flex-1 rounded border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink placeholder:text-dim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent" placeholder="описание задачи" value={taskDraft} onChange={(e) => setTaskDraft(e.target.value)} disabled={busy} />
          <button className="rounded border border-line-strong px-2 py-1 text-xs text-dim transition-colors hover:text-ink disabled:opacity-50" disabled={busy || !taskDraft.trim()} onClick={() => { void post({ action: 'task', description: taskDraft.trim() }); setTaskDraft(''); }}>set</button>
        </div>
      </section>

      {/* Working facts */}
      <section>
        <div className="flex items-center justify-between">
          <h4 className="text-xs uppercase tracking-wide text-dim">Working facts (контекст задачи)</h4>
          <button className="text-xs text-err hover:underline disabled:opacity-50" disabled={busy || workingEntries.length === 0} onClick={() => void post({ action: 'task-clear' })}>clear all</button>
        </div>
        <ul className="mt-1 space-y-1">
          {workingEntries.length === 0 && <li className="text-xs text-dim">пусто</li>}
          {workingEntries.map(([k, v]) => (
            <li key={k} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate"><span className="font-mono text-dim">{k}</span>: {v}</span>
              <button className="text-xs text-err hover:underline disabled:opacity-50" disabled={busy} onClick={() => void post({ action: 'fact-rm', key: k })}>rm</button>
            </li>
          ))}
        </ul>
        <div className="mt-1 flex gap-1">
          <input className="flex-1 rounded border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink placeholder:text-dim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent" placeholder="ключ" value={wfKey} onChange={(e) => setWfKey(e.target.value)} disabled={busy} />
          <input className="flex-1 rounded border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink placeholder:text-dim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent" placeholder="значение" value={wfVal} onChange={(e) => setWfVal(e.target.value)} disabled={busy} />
          <button className="rounded border border-line-strong px-2 py-1 text-xs text-dim transition-colors hover:text-ink disabled:opacity-50" disabled={busy || !wfKey.trim()} onClick={() => { void post({ action: 'task-add', key: wfKey.trim(), value: wfVal }); setWfKey(''); setWfVal(''); }}>add</button>
        </div>
      </section>

      {error && <p className="text-xs text-err">{error}</p>}
    </div>
  );
}
