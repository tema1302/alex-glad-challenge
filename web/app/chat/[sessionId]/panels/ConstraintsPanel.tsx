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
      {view && view.items.length === 0 && <p className="text-xs text-neutral-400">инвариантов нет</p>}
      {TYPE_ORDER.filter((t) => grouped.has(t)).map((t) => (
        <section key={t}>
          <h4 className="text-xs uppercase tracking-wide text-neutral-500">{TYPE_LABELS[t] ?? t}</h4>
          <ul className="mt-1 space-y-1">
            {grouped.get(t)!.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-2 text-sm">
                <span>
                  <span className="font-medium">{c.title}</span>
                  {c.description && <span className="text-neutral-500">: {c.description}</span>}
                  <span className="ml-1 font-mono text-xs text-neutral-400">{c.id}</span>
                </span>
                <button className="text-xs text-red-600 hover:underline disabled:opacity-50" disabled={busy} onClick={() => void post({ action: 'rm', id: c.id })}>rm</button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="space-y-1 border-t border-neutral-200 pt-2 dark:border-neutral-800">
        <h4 className="text-xs uppercase tracking-wide text-neutral-500">Добавить инвариант</h4>
        <select className="w-full rounded border border-neutral-300 bg-neutral-50 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950" value={type} onChange={(e) => setType(e.target.value)} disabled={busy}>
          {TYPE_ORDER.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
        </select>
        <input className="w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950" placeholder="название" value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
        <input className="w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950" placeholder="описание" value={desc} onChange={(e) => setDesc(e.target.value)} disabled={busy} />
        <button
          className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-neutral-700"
          disabled={busy || !title.trim()}
          onClick={() => { void post({ action: 'add', type, title: title.trim(), description: desc.trim() }); setTitle(''); setDesc(''); }}
        >+ add</button>
      </section>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
