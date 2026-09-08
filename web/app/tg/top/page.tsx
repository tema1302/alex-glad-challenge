// /tg/top — топ-сообщения TG-топика (read-only). web P3a.
// 'use client': форма (chatKey, topicId, limit, by) → GET /api/tg/top → таблица.
// tg.sqlite только читается; publish/collect — в P3b.
//
// Редизайн C (день 30): read-only архетип — <Card> типографика, параграфы text-ink.
'use client';

import { useState } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { INPUT_CLASS } from '../../components/ui/Field';
import { SectionHead } from '../../components/ui/SectionHead';

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
      <SectionHead
        code="tg · top"
        title="TG-топ сообщений"
        description="Топ сообщений forum-топика по реакциям или дате (только чтение)."
      />

      <Card label="параметры">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 text-sm">
            <span className="block text-xs font-medium text-dim">chatKey</span>
            <input
              className={`mt-1 w-full font-mono text-xs ${INPUT_CLASS}`}
              value={chatKey} onChange={(e) => setChatKey(e.target.value)} disabled={loading}
              placeholder="-1001234567890"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs font-medium text-dim">topicId</span>
            <input
              className={`mt-1 w-24 ${INPUT_CLASS}`}
              value={topicId} onChange={(e) => setTopicId(e.target.value)} disabled={loading}
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs font-medium text-dim">лимит</span>
            <input
              className={`mt-1 w-20 ${INPUT_CLASS}`}
              type="number" min={1} max={100}
              value={limit} onChange={(e) => setLimit(e.target.value)} disabled={loading}
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs font-medium text-dim">сортировка</span>
            <select
              className={`mt-1 ${INPUT_CLASS}`}
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
        <Card tone="danger">
          <p className="text-sm text-err">{error}</p>
        </Card>
      )}

      {data && (
        <section className="space-y-2">
          <p className="text-xs text-dim">
            Найдено {data.count} · показано {data.messages.length} · сортировка:{' '}
            {data.by === 'reactions' ? 'по реакциям' : 'по дате'}
          </p>
          {data.messages.length === 0 ? (
            <EmptyState
              title="Нет данных по этому чату/топику."
              hint="Возможные причины: чат/топик не собран (см. TG collect), неверный topicId или сообщения без текста."
            />
          ) : (
            <ul className="divide-y divide-line">
              {data.messages.map((m) => (
                <li key={m.msg_id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-dim">
                    <span>#{m.msg_id}</span>
                    <span>{m.from_name}</span>
                    <span>{m.date_iso}</span>
                    {m.reaction_total > 0 && <Badge tone="accent">♥ {m.reaction_total}</Badge>}
                    {Object.entries(m.reactions).map(([emo, n]) => (
                      <span key={emo}>{emo} {n}</span>
                    ))}
                  </div>
                  <p className="mt-1 line-clamp-4 whitespace-pre-wrap font-sans text-sm text-ink">
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
