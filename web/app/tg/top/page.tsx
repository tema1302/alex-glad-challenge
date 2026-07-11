// /tg/top — топ-сообщения TG-топика (read-only). web P3a.
// 'use client': форма (chatKey, topicId, limit, by) → GET /api/tg/top → таблица.
// tg.sqlite только читается; publish/collect — в P3b.
//
// Редизайн C (день 30): read-only архетип — <Card> типографика, параграфы text-ink.
'use client';

import { useState } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

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

const INPUT =
  'rounded border border-line-strong bg-surface-2 px-2 py-1 text-ink placeholder:text-dim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent';

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
        <h1 className="text-xl font-semibold text-ink">TG-топ сообщений</h1>
        <p className="mt-1 text-sm text-dim">
          Топ сообщений forum-топика по реакциям или дате. Только чтение из tg.sqlite.
        </p>
      </section>

      <Card label="параметры">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 text-sm">
            <span className="block text-xs uppercase tracking-wide text-dim">chatKey</span>
            <input
              className={`mt-1 w-full font-mono text-xs ${INPUT}`}
              value={chatKey} onChange={(e) => setChatKey(e.target.value)} disabled={loading}
              placeholder="-1001234567890"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-dim">topicId</span>
            <input
              className={`mt-1 w-24 ${INPUT}`}
              value={topicId} onChange={(e) => setTopicId(e.target.value)} disabled={loading}
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-dim">лимит</span>
            <input
              className={`mt-1 w-20 ${INPUT}`}
              type="number" min={1} max={100}
              value={limit} onChange={(e) => setLimit(e.target.value)} disabled={loading}
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-dim">сортировка</span>
            <select
              className={`mt-1 ${INPUT}`}
              value={by} onChange={(e) => setBy(e.target.value as 'reactions' | 'date')} disabled={loading}
            >
              <option value="reactions">по реакциям</option>
              <option value="date">по дате</option>
            </select>
          </label>
          <Button variant="primary" onClick={() => void run()} disabled={loading || !chatKey.trim()}>
            {loading ? '…' : 'Показать'}
          </Button>
        </div>
      </Card>

      {error && (
        <p className="rounded-md border border-err/40 bg-err/10 p-2 text-sm text-err">
          {error}
        </p>
      )}

      {data && (
        <section className="space-y-2">
          <p className="font-mono text-xs text-dim">
            {data.count} сообщений в {data.chatKey}/{data.topicId} · показано {data.messages.length} · сортировка: {data.by}
          </p>
          {data.messages.length === 0 ? (
            <Card>
              <p className="text-sm text-dim">
                Нет данных по этому chatKey/topicId. Возможные причины: чат/топик не собран
                (collect — P3b), неверный topicId, или сообщения без текста.
              </p>
            </Card>
          ) : (
            <ul className="space-y-2">
              {data.messages.map((m) => (
                <li key={m.msg_id}>
                  <Card>
                    <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-dim">
                      <span>#{m.msg_id}</span>
                      <span>{m.from_name}</span>
                      <span>{m.date_iso}</span>
                      {m.reaction_total > 0 && (
                        <span className="rounded-full border border-warn/40 px-2 py-0.5 text-warn">
                          ♥ {m.reaction_total}
                        </span>
                      )}
                      {Object.entries(m.reactions).map(([emo, n]) => (
                        <span key={emo}>{emo} {n}</span>
                      ))}
                    </div>
                    <p className="mt-1 line-clamp-4 whitespace-pre-wrap font-sans text-sm text-ink">
                      {m.text || '(без текста)'}
                    </p>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
