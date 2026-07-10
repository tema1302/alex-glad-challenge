// Profile-панель: selector + edit-via-LLM + new/note/reset. web P2b.
// 'use client'; LLM-edit идёт server-side (POST /profile action:edit).
'use client';
import { useState } from 'react';
import { usePanelView } from './usePanelView';

interface ProfileView {
  profiles: string[];
  active: string | null;
  snapshot: { любимый_клуб: string; стиль: string; notes: string[] } & Record<string, unknown> | null;
}

export function ProfilePanel({ sessionId }: { sessionId: string }) {
  const { view, error, busy, post } = usePanelView<ProfileView>(`/api/chat/${sessionId}/profile`);
  const [instruction, setInstruction] = useState('');
  const [summary, setSummary] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [note, setNote] = useState('');

  if (!view) return <p className="text-xs text-neutral-400">profile: загрузка…</p>;

  return (
    <div className="space-y-3">
      <section>
        <h4 className="text-xs uppercase tracking-wide text-neutral-500">Активный профиль</h4>
        <select
          className="mt-1 w-full rounded border border-neutral-300 bg-neutral-50 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          value={view.active ?? ''}
          disabled={busy}
          onChange={(e) => void post({ action: 'use', name: e.target.value })}
        >
          {view.profiles.length === 0 && <option value="">(нет профилей)</option>}
          {view.profiles.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </section>

      {view.snapshot && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-neutral-500">snapshot профиля ({view.snapshot.notes.length} notes)</summary>
          <pre className="mt-1 max-h-40 overflow-auto rounded bg-neutral-100 p-2 text-xs dark:bg-neutral-800">{JSON.stringify(view.snapshot, null, 2)}</pre>
        </details>
      )}

      {/* Edit via LLM */}
      <section>
        <h4 className="text-xs uppercase tracking-wide text-neutral-500">Edit через LLM</h4>
        <textarea
          className="mt-1 w-full resize-y rounded border border-neutral-300 bg-neutral-50 p-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          rows={2}
          placeholder="напр: смени клуб на Арсенал, добавь заметку про стиль"
          value={instruction}
          onChange={(e) => { setInstruction(e.target.value); setSummary(null); }}
          disabled={busy}
        />
        <button
          className="mt-1 rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-neutral-700"
          disabled={busy || !instruction.trim()}
          onClick={async () => {
            const r = await post({ action: 'edit', instruction: instruction.trim() });
            if (r && typeof r.summary === 'string') { setSummary(r.summary); setInstruction(''); }
          }}
        >
          {busy ? 'LLM редактирует…' : 'применить через LLM'}
        </button>
        {summary && <pre className="mt-1 whitespace-pre-wrap rounded bg-neutral-100 p-2 text-xs dark:bg-neutral-800">{summary}</pre>}
      </section>

      {/* New / note / reset */}
      <section className="flex flex-wrap gap-2">
        <input className="flex-1 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950" placeholder="новый профиль" value={newName} onChange={(e) => setNewName(e.target.value)} disabled={busy} />
        <button className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-neutral-700" disabled={busy || !newName.trim()} onClick={() => { void post({ action: 'new', name: newName.trim() }); setNewName(''); }}>+ new</button>
        <button className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-neutral-700" disabled={busy || !view.active} onClick={() => { if (confirm('Сбросить активный профиль к значениям по умолчанию?')) void post({ action: 'reset' }); }}>reset</button>
      </section>
      <section className="flex gap-2">
        <input className="flex-1 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950" placeholder="заметка к активному профилю" value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
        <button className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-neutral-700" disabled={busy || !note.trim() || !view.active} onClick={() => { void post({ action: 'note', text: note.trim() }); setNote(''); }}>+ note</button>
      </section>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
