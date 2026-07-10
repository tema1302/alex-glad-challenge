// /tg/top — топ-сообщения TG-топика (read-only). web P3a.
// 'use client': форма (chatKey, topicId, limit, by) → GET /api/tg/top → таблица.
// tg.sqlite только читается; publish/collect — в P3b.
'use client';

import { useState } from 'react';

interface TopMessage {
  msg_id: number;
  from_name: string;
  text: string;
  date_iso: string;
  reaction_total: number;
  reactions: Record<string, number>;
}
interface TopResult {
  messages: TopMessage[];
  count: number;
  chatKey: string;
  topicId: number;
  by: string;
}

export default function TgTopPage() {
  const [chatKey, setChatKey] = useState('');
  const [topicId, setTopicId] = useState('1');
  const [limit, setLimit] = useState('20');
  const [by, setBy] = useState<'reactions' | 'date'>('reactions');

  const [data, setData] = useState<TopResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async (): Promise<void> => {
    if (!chatKey.trim()) { setError('Укажите chatKey'); return; }
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const qs = new URLSearchParams({
        chatKey: chatKey.trim(),
        topicId: topicId || '1',
        limit: limit || '20',
        by,
      });
      const r = await fetch(`/api/tg/top?${qs.toString()}`);
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      setData((await r.json()) as TopResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold">TG-топ сообщений</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Топ сообщений forum-топика по реакциям или дате. Только чтение из tg.sqlite.
        </p>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 text-sm">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">chatKey</span>
            <input
              className="mt-1 w-full rounded border border-neutral-300 bg-neutral-50 px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950"
              value={chatKey} onChange={(e) => setChatKey(e.target.value)} disabled={loading}
              placeholder="-1001234567890"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">topicId</span>
            <input
              className="mt-1 w-24 rounded border border-neutral-300 bg-neutral-50 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              value={topicId} onChange={(e) => setTopicId(e.target.value)} disabled={loading}
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">лимит</span>
            <input
              className="mt-1 w-20 rounded border border-neutral-300 bg-neutral-50 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              type="number" min={1} max={100}
              value={limit} onChange={(e) => setLimit(e.target.value)} disabled={loading}
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">сортировка</span>
            <select
              className="mt-1 rounded border border-neutral-300 bg-neutral-50 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              value={by} onChange={(e) => setBy(e.target.value as 'reactions' | 'date')} disabled={loading}
            >
              <option value="reactions">по реакциям</option>
              <option value="date">по дате</option>
            </select>
          </label>
          <button
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            onClick={() => void run()}
            disabled={loading || !chatKey.trim()}
          >
            {loading ? '…' : 'Показать'}
          </button>
        </div>
      </section>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {data && (
        <section className="space-y-2">
          <p className="text-xs text-neutral-400">
            {data.count} сообщений в {data.chatKey}/{data.topicId} · показано {data.messages.length} · сортировка: {data.by}
          </p>
          {data.messages.length === 0 ? (
            <p className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900">
              Нет данных по этому chatKey/topicId. Возможные причины: чат/топик не собран
              (collect — P3b), неверный topicId, или сообщения без текста.
            </p>
          ) : (
            <ul className="space-y-2">
              {data.messages.map((m) => (
                <li key={m.msg_id} className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                    <span className="font-mono">#{m.msg_id}</span>
                    <span>{m.from_name}</span>
                    <span>{m.date_iso}</span>
                    {m.reaction_total > 0 && (
                      <span className="rounded-full border border-amber-300 px-2 py-0.5 text-amber-700 dark:border-amber-700 dark:text-amber-400">
                        ♥ {m.reaction_total}
                      </span>
                    )}
                    {Object.entries(m.reactions).map(([emo, n]) => (
                      <span key={emo} className="text-xs">{emo} {n}</span>
                    ))}
                  </div>
                  <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">
                    {m.text || '(без текста)'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
