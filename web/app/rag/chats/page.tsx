// /rag/chats — каталог TG-чатов и aliases. web P3a.
// 'use client': GET /api/rag/chats (titles + aliases + dialog-chats), POST add/rm alias.
// Все offline (chatCatalog JSON-кэш из index-tg + alias-файл), без сетевых вызовов к TG.
'use client';

import { useCallback, useEffect, useState } from 'react';

interface AliasRow {
  name: string;
  chatKey: string;
  topicId?: number;
}
interface DialogChatItem {
  id: string;
  title: string;
  msg_count: number;
  updated_at: string;
}
interface Catalog {
  titles: Record<string, string>;
  aliases: AliasRow[];
  chats: DialogChatItem[];
}

export default function RagChatsPage() {
  const [data, setData] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [chatKey, setChatKey] = useState('');
  const [topicId, setTopicId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const r = await fetch('/api/rag/chats');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData((await r.json()) as Catalog);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const submit = async (action: 'add' | 'rm', payload: { name: string; chatKey?: string; topicId?: number }): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/rag/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      setName(''); setChatKey(''); setTopicId('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'action failed');
    } finally {
      setBusy(false);
    }
  };

  const titleEntries = data ? Object.entries(data.titles) : [];

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold">Каталог чатов</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Кэш chatKey→title (из index-tg) и aliases для RAG-чата. Только чтение, offline.
        </p>
      </section>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {/* Add alias */}
      <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Добавить alias</h2>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">Имя</span>
            <input
              className="mt-1 w-40 rounded border border-neutral-300 bg-neutral-50 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              value={name} onChange={(e) => setName(e.target.value)} disabled={busy}
              placeholder="news_ru"
            />
          </label>
          <label className="flex-1 text-sm">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">chatKey</span>
            <input
              className="mt-1 w-full rounded border border-neutral-300 bg-neutral-50 px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950"
              list="chatkey-dl"
              value={chatKey} onChange={(e) => setChatKey(e.target.value)} disabled={busy}
              placeholder="-1001234567890"
            />
            <datalist id="chatkey-dl">
              {titleEntries.map(([k]) => <option key={k} value={k} />)}
            </datalist>
          </label>
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">topicId (опц.)</span>
            <input
              className="mt-1 w-24 rounded border border-neutral-300 bg-neutral-50 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              value={topicId} onChange={(e) => setTopicId(e.target.value)} disabled={busy}
            />
          </label>
          <button
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            onClick={() => void submit('add', { name: name.trim(), chatKey: chatKey.trim(), topicId: topicId ? Number(topicId) : undefined })}
            disabled={busy || !name.trim() || !chatKey.trim()}
          >
            добавить
          </button>
        </div>
      </section>

      {/* Aliases */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Aliases {data ? `(${data.aliases.length})` : ''}
        </h2>
        {!data ? (
          <p className="mt-2 text-sm text-neutral-400">Загрузка…</p>
        ) : data.aliases.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-400">Нет aliases.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {data.aliases.map((a) => (
              <li key={a.name} className="flex items-center gap-3 rounded border border-neutral-200 bg-white p-2 text-sm dark:border-neutral-800 dark:bg-neutral-900">
                <span className="font-medium">{a.name}</span>
                <span className="font-mono text-xs text-neutral-400">{a.chatKey}</span>
                {a.topicId != null && <span className="text-xs text-neutral-400">topic {a.topicId}</span>}
                {data.titles[a.chatKey] && <span className="text-xs text-neutral-500">{data.titles[a.chatKey]}</span>}
                <button
                  className="ml-auto rounded border border-red-300 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400"
                  onClick={() => void submit('rm', { name: a.name })}
                  disabled={busy}
                >
                  удалить
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Titles catalog */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Кэш chatKey→title {data ? `(${titleEntries.length})` : ''}
        </h2>
        {!data ? (
          <p className="mt-2 text-sm text-neutral-400">Загрузка…</p>
        ) : titleEntries.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-400">
            Кэш пуст. Наполняется при индексации TG (P3b: <code>rag index-tg</code>).
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {titleEntries.map(([k, t]) => (
              <li key={k} className="flex gap-3">
                <span className="font-mono text-xs text-neutral-400">{k}</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* DialogDb chats */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          RAG-чаты (DialogDb) {data ? `(${data.chats.length})` : ''}
        </h2>
        {!data ? (
          <p className="mt-2 text-sm text-neutral-400">Загрузка…</p>
        ) : data.chats.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-400">Нет чатов. Создайте на <a href="/rag/chat" className="text-accent hover:underline">/rag/chat</a>.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {data.chats.map((c) => (
              <li key={c.id} className="flex flex-wrap gap-3">
                <a href={`/rag/chat/${c.id}`} className="font-mono text-xs text-accent hover:underline">{c.id.slice(0, 8)}</a>
                <span>{c.title}</span>
                <span className="text-xs text-neutral-400">{c.msg_count} сообщений</span>
                <span className="text-xs text-neutral-400">{c.updated_at}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
