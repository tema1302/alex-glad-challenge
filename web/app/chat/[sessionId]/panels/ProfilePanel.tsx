// Profile-панель: selector + edit-via-LLM + new/note/reset. web P2b.
// 'use client'; LLM-edit идёт server-side (POST /profile action:edit).
// reset — мутация активного профиля: ConfirmDialog вместо confirm() (ТЗ G4).
'use client';
import { useState } from 'react';
import { usePanelView } from './usePanelView';
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';

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
  const [resetOpen, setResetOpen] = useState(false);

  if (!view) return <p className="text-xs text-dim">profile: загрузка…</p>;

  return (
    <div className="space-y-3">
      <section>
        <h4 className="text-xs uppercase tracking-wide text-dim">Активный профиль</h4>
        <select
          className="mt-1 w-full rounded-md border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim"
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
          <summary className="cursor-pointer text-xs text-dim">snapshot профиля ({view.snapshot.notes.length} notes)</summary>
          <pre className="mt-1 max-h-40 overflow-auto rounded bg-surface-2 p-2 text-xs text-ink">{JSON.stringify(view.snapshot, null, 2)}</pre>
        </details>
      )}

      {/* Edit via LLM */}
      <section>
        <h4 className="text-xs uppercase tracking-wide text-dim">Edit через LLM</h4>
        <textarea
          className="mt-1 w-full resize-y rounded-md border border-line-strong bg-surface-2 p-2 text-sm text-ink placeholder:text-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim"
          rows={2}
          placeholder="напр: смени клуб на Арсенал, добавь заметку про стиль"
          value={instruction}
          onChange={(e) => { setInstruction(e.target.value); setSummary(null); }}
          disabled={busy}
        />
        <Button
          size="sm"
          className="mt-1"
          disabled={busy || !instruction.trim()}
          onClick={async () => {
            const r = await post({ action: 'edit', instruction: instruction.trim() });
            if (r && typeof r.summary === 'string') { setSummary(r.summary); setInstruction(''); }
          }}
        >
          {busy ? 'LLM редактирует…' : 'применить через LLM'}
        </Button>
        {summary && <pre className="mt-1 whitespace-pre-wrap rounded bg-surface-2 p-2 text-xs text-ink">{summary}</pre>}
      </section>

      {/* New / note / reset */}
      <section className="flex flex-wrap gap-2">
        <input className="min-w-0 flex-1 rounded-md border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink placeholder:text-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim" placeholder="новый профиль" value={newName} onChange={(e) => setNewName(e.target.value)} disabled={busy} />
        <Button size="sm" disabled={busy || !newName.trim()} onClick={() => { void post({ action: 'new', name: newName.trim() }); setNewName(''); }}>+ new</Button>
        <Button size="sm" variant="danger" disabled={busy || !view.active} onClick={() => setResetOpen(true)}>reset</Button>
      </section>
      <section className="flex gap-2">
        <input className="min-w-0 flex-1 rounded-md border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink placeholder:text-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim" placeholder="заметка к активному профилю" value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
        <Button size="sm" disabled={busy || !note.trim() || !view.active} onClick={() => { void post({ action: 'note', text: note.trim() }); setNote(''); }}>+ note</Button>
      </section>

      <ConfirmDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={async () => {
          await post({ action: 'reset' });
        }}
        title="Сбросить профиль?"
        confirmLabel="Сбросить"
        body={<p>Активный профиль будет сброшен к значениям по умолчанию.</p>}
      />

      {error && <p className="text-xs text-err">{error}</p>}
    </div>
  );
}
