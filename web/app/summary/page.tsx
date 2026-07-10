// /summary — сводка ожидающих задач + кнопка «отправить в TG» (день 28, web P5).
// 'use client': GET /api/summary (текст + publishable). Кнопка publish с confirm + gate
// (показывается только при publishable). НИКАКИХ импортов core/.
'use client';

import { useCallback, useEffect, useState } from 'react';

export default function SummaryPage() {
  const [summary, setSummary] = useState<string | null>(null);
  const [publishable, setPublishable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishedId, setPublishedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPublishedId(null);
    try {
      const r = await fetch('/api/summary');
      const data = (await r.json()) as { summary?: string; publishable?: boolean };
      setSummary(data.summary ?? '');
      setPublishable(Boolean(data.publishable));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const publish = useCallback(async () => {
    if (publishing || !publishable) return;
    if (!window.confirm('Отправить сводку в Telegram-канал?')) return;
    setPublishing(true);
    setError(null);
    setPublishedId(null);
    try {
      const r = await fetch('/api/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publish: true }),
      });
      const data = (await r.json()) as { ok?: boolean; messageId?: number; error?: string };
      if (!r.ok || !data.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setPublishedId(data.messageId ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'publish failed');
    } finally {
      setPublishing(false);
    }
  }, [publishing, publishable]);

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold">Сводка задач</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Ожидающие задачи из <code className="rounded bg-neutral-200 px-1 text-xs dark:bg-neutral-800">TodoDb</code>.
          Можно отправить сводку в Telegram-канал (если настроен Bot API).
        </p>
      </section>

      <div className="flex items-center gap-3">
        <button
          className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          onClick={load}
          disabled={loading}
        >
          обновить
        </button>
        {publishable && (
          <button
            className="rounded border border-accent px-3 py-1.5 text-sm font-medium text-accent disabled:opacity-50"
            onClick={publish}
            disabled={publishing || loading}
          >
            {publishing ? 'Отправка…' : 'Отправить в TG'}
          </button>
        )}
        {!publishable && (
          <span className="text-xs text-neutral-400">TG Bot API не настроен — публикация недоступна</span>
        )}
      </div>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {publishedId !== null && (
        <p className="rounded border border-green-300 bg-green-50 p-2 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
          Отправлено (message_id: {publishedId}).
        </p>
      )}

      <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        {summary === null ? (
          <p className="text-sm text-neutral-400">{loading ? 'Загрузка…' : 'Нет данных.'}</p>
        ) : (
          <pre className="whitespace-pre-wrap font-sans text-sm text-neutral-700 dark:text-neutral-300">
            {summary}
          </pre>
        )}
      </section>
    </div>
  );
}
