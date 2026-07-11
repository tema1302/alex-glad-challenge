// Constraints-панель: инварианты по типам + add/rm. web P2b. Глобальны (constraints.json).
'use client';
import { useState } from 'react';
import { usePanelView } from './usePanelView';

interface ConstraintItem { id: string; type: string; title: string; description: string; createdAt: string; }
interface ConstraintsView { items: ConstraintItem[]; }

const TYPE_LABELS: Record<string, string> = {
  architecture: 'Архитектура',
  tech_decision: 'Технические решения',
  stack: 'Стек',
  business: 'Бизнес-правила',
  custom: 'Прочее',
};
const TYPE_ORDER = ['architecture', 'tech_decision', 'stack', 'business', 'custom'];

export function ConstraintsPanel({ sessionId }: { sessionId: string }) {
  const { view, error, busy, post } = usePanelView<ConstraintsView>(`/api/chat/${sessionId}/constraints`);
  const [type, setType] = useState('stack');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');

  const grouped = new Map<string, ConstraintItem[]>();
  for (const it of view?.items ?? []) {
    if (!grouped.has(it.type)) grouped.set(it.type, []);
    grouped.get(it.type)!.push(it);
  }

  return (
    <div className="space-y-3">
      {view && view.items.length === 0 && <p className="text-xs text-dim">инвариантов нет</p>}
      {TYPE_ORDER.filter((t) => grouped.has(t)).map((t) => (
        <section key={t}>
          <h4 className="text-xs uppercase tracking-wide text-dim">{TYPE_LABELS[t] ?? t}</h4>
          <ul className="mt-1 space-y-1">
            {grouped.get(t)!.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-2 text-sm">
                <span>
                  <span className="font-medium text-ink">{c.title}</span>
                  {c.description && <span className="text-dim">: {c.description}</span>}
                  <span className="ml-1 font-mono text-xs text-dim">{c.id}</span>
                </span>
                <button className="text-xs text-err hover:underline disabled:opacity-50" disabled={busy} onClick={() => void post({ action: 'rm', id: c.id })}>rm</button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="space-y-1 border-t border-line pt-2">
        <h4 className="text-xs uppercase tracking-wide text-dim">Добавить инвариант</h4>
        <select className="w-full rounded border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent" value={type} onChange={(e) => setType(e.target.value)} disabled={busy}>
          {TYPE_ORDER.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
        </select>
        <input className="w-full rounded border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink placeholder:text-dim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent" placeholder="название" value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
        <input className="w-full rounded border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink placeholder:text-dim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent" placeholder="описание" value={desc} onChange={(e) => setDesc(e.target.value)} disabled={busy} />
        <button
          className="rounded border border-line-strong px-2 py-1 text-xs text-dim transition-colors hover:text-ink disabled:opacity-50"
          disabled={busy || !title.trim()}
          onClick={() => { void post({ action: 'add', type, title: title.trim(), description: desc.trim() }); setTitle(''); setDesc(''); }}
        >+ add</button>
      </section>

      {error && <p className="text-xs text-err">{error}</p>}
    </div>
  );
}
