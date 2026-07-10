// /rag/chat — выбор/создание RAG-чата (DialogDb). web P3a.
// 'use client': список чатов (GET /api/rag/chat) + форма создания (POST → redirect).
// Сессия персистится в dialog.sqlite (история + task state), переживает reload.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface DialogChatItem {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  msg_count: number;
}

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
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold">RAG-чат</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Многоходовый диалог по базе знаний. История и «память задачи» персистятся в dialog.sqlite.
        </p>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Новый чат</h2>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="flex-1 text-sm">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">Заголовок (опц.)</span>
            <input
              className="mt-1 w-full rounded border border-neutral-300 bg-neutral-50 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              placeholder="untitled"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={creating}
            />
          </label>
          <button
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            onClick={() => void create()}
            disabled={creating}
          >
            {creating ? 'создаю…' : 'Создать и открыть'}
          </button>
        </div>
      </section>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Чаты {chats ? `(${chats.length})` : ''}
        </h2>
        {chats === null ? (
          <p className="mt-2 text-sm text-neutral-400">Загрузка…</p>
        ) : chats.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-400">Нет чатов. Создайте первый выше.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {chats.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/rag/chat/${c.id}`}
                  className="block rounded-lg border border-neutral-200 bg-white p-3 text-sm hover:border-accent dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-neutral-400">{c.id.slice(0, 8)}</span>
                    <span className="text-xs text-neutral-400">{c.msg_count} сообщений</span>
                    <span className="text-xs text-neutral-400">{c.updated_at}</span>
                  </div>
                  <div className="mt-1 truncate text-xs text-neutral-500">{c.title}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
