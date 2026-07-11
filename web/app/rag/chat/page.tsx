// /rag/chat — выбор/создание RAG-чата (DialogDb). web P3a.
// 'use client': список чатов (GET /api/rag/chat) + форма создания (POST → redirect).
// Сессия персистится в dialog.sqlite (история + task state), переживает reload.
// Редизайн C (день 30): Card-форма + data-list ссылок. Логика без изменений.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { SectionLabel } from '../../components/ui/SectionLabel';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

interface DialogChatItem {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  msg_count: number;
}

const INPUT =
  'rounded border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink placeholder:text-dim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-50';
const LABEL_TAG = 'block font-mono text-xs uppercase tracking-wider text-dim';

export default function RagChatPickerPage() {
  const router = useRouter();
  const [chats, setChats] = useState<DialogChatItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const r = await fetch('/api/rag/chat');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { chats: DialogChatItem[] };
      setChats(data.chats);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async (): Promise<void> => {
    setCreating(true);
    setError(null);
    try {
      const r = await fetch('/api/rag/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title || undefined }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { id: string };
      router.push(`/rag/chat/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'create failed');
      setCreating(false);
    }
  };

  return (
    <div className="space-y-8">
      <section>
        <SectionLabel>rag · dialog</SectionLabel>
        <h1 className="font-mono text-2xl font-semibold uppercase tracking-tight text-ink">RAG-чат</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-dim">
          Многоходовый диалог по базе знаний. История и «память задачи» персистятся в{' '}
          <code className="font-mono text-[12px] text-ink">dialog.sqlite</code>.
        </p>
      </section>

      <Card label="new chat">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 text-sm">
            <span className={LABEL_TAG}>Заголовок (опц.)</span>
            <input
              className={`mt-1 w-full ${INPUT}`}
              placeholder="untitled"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={creating}
            />
          </label>
          <Button variant="primary" onClick={() => void create()} disabled={creating}>
            {creating ? 'создаю…' : 'Создать и открыть'}
          </Button>
        </div>
      </Card>

      {error && (
        <p className="rounded-md border border-err/40 bg-err/10 p-2 text-sm text-err">{error}</p>
      )}

      <section>
        <SectionLabel>{chats ? `чаты · ${chats.length}` : 'чаты'}</SectionLabel>
        {chats === null ? (
          <p className="text-sm text-dim">Загрузка…</p>
        ) : chats.length === 0 ? (
          <p className="text-sm text-dim">Нет чатов. Создайте первый выше.</p>
        ) : (
          <ul className="space-y-2">
            {chats.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/rag/chat/${c.id}`}
                  className="block rounded-md border border-line bg-surface p-3 text-sm transition-colors duration-150 hover:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-dim">{c.id.slice(0, 8)}</span>
                    <span className="font-mono text-xs text-dim">{c.msg_count} сообщений</span>
                    <span className="font-mono text-xs text-dim">{c.updated_at}</span>
                  </div>
                  <div className="mt-1 truncate text-ink">{c.title}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
