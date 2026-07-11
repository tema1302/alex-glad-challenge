// /summary — сводка ожидающих задач + кнопка «отправить в TG» (день 28, web P5).
// 'use client': GET /api/summary (текст + publishable). Кнопка publish с confirm + gate
// (показывается только при publishable). НИКАКИХ импортов core/.
//
// Редизайн C (день 30): read-only архетип — <Card> типографика, параграфы text-ink.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

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
        <h1 className="text-xl font-semibold text-ink">Сводка задач</h1>
        <p className="mt-1 text-sm text-dim">
          Ожидающие задачи из <code className="rounded bg-surface-2 px-1 font-mono text-xs text-dim">TodoDb</code>.
          Можно отправить сводку в Telegram-канал (если настроен Bot API).
        </p>
      </section>

      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={load} disabled={loading}>
          обновить
        </Button>
        {publishable && (
          <Button variant="ghost" onClick={publish} disabled={publishing || loading}>
            {publishing ? 'Отправка…' : 'Отправить в TG'}
          </Button>
        )}
        {!publishable && (
          <span className="text-xs text-dim">TG Bot API не настроен — публикация недоступна</span>
        )}
      </div>

      {error && (
        <p className="rounded-md border border-err/40 bg-err/10 p-2 text-sm text-err">
          {error}
        </p>
      )}

      {publishedId !== null && (
        <p className="rounded-md border border-ok/40 bg-ok/10 p-2 text-sm text-ok">
          Отправлено (message_id: {publishedId}).
        </p>
      )}

      <Card label="сводка">
        {summary === null ? (
          <p className="text-sm text-dim">{loading ? 'Загрузка…' : 'Нет данных.'}</p>
        ) : (
          <p className="whitespace-pre-wrap font-sans text-sm text-ink">
            {summary}
          </p>
        )}
      </Card>
    </div>
  );
}
