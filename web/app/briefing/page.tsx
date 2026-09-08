// /briefing — read-only сводка системы. web P3a.
// 'use client': GET /api/briefing (todos + stats, всегда) + опц. chatKey/topicId → топ-TG.
// БЕЗ publish в TG (P3b). Просто витрина-сводка.
//
// Редизайн C (день 30): read-only архетип — <SectionLabel> + <Card>/<Tile> типографика.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Tile } from '../components/ui/Tile';
import { SectionLabel } from '../components/ui/SectionLabel';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { INPUT_CLASS } from '../components/ui/Field';
import { SectionHead } from '../components/ui/SectionHead';

interface BriefingStats {
  news: number;
  posts: number;
  ragFixed: number;
  ragStructure: number;
  ragTelegram: number;
  tgMessages: number;
  tgChats: number;
  tgTopics: number;
  dialogChats: number;
  dialogMessages: number;
}
interface TopMsg {
  msg_id: number;
  from_name: string;
  text: string;
  date_iso: string;
  reaction_total: number;
}
interface Briefing {
  todoSummary: string;
  stats: BriefingStats;
  topTg?: TopMsg[];
  chatKey?: string;
  topicId: number;
}

export default function BriefingPage() {
  const [data, setData] = useState<Briefing | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [chatKey, setChatKey] = useState('');
  const [topicId, setTopicId] = useState('1');

  const load = useCallback(async (ck?: string, tid?: string): Promise<void> => {
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (ck?.trim()) {
        qs.set('chatKey', ck.trim());
        qs.set('topicId', tid && tid.trim() ? tid.trim() : '1');
      }
      const r = await fetch(`/api/briefing${qs.toString() ? `?${qs.toString()}` : ''}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData((await r.json()) as Briefing);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const ragTotal = data ? data.stats.ragFixed + data.stats.ragStructure + data.stats.ragTelegram : 0;

  return (
    <div className="space-y-6">
      <SectionHead
        code="sys · briefing"
        title="Сводка"
        description="Текущее состояние: задачи, счётчики баз, топ-TG (только чтение)."
      />

      {/* Топ-TG по chatKey (опц.) */}
      <Card label="топ-TG по чату">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 text-sm">
            <span className="block text-xs font-medium text-dim">chatKey</span>
            <input
              className={`mt-1 w-full font-mono text-xs ${INPUT_CLASS}`}
              value={chatKey} onChange={(e) => setChatKey(e.target.value)}
              placeholder="-1001234567890 (пусто — без топ-TG)"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs font-medium text-dim">topicId</span>
            <input
              className={`mt-1 w-24 ${INPUT_CLASS}`}
              value={topicId} onChange={(e) => setTopicId(e.target.value)}
            />
          </label>
          <Button variant="primary" onClick={() => void load(chatKey, topicId)}>
            обновить
          </Button>
        </div>
      </Card>

      {error && (
        <Card tone="danger">
          <p className="text-sm text-err">{error}</p>
        </Card>
      )}

      {!data ? (
        <p className="text-sm text-dim">Загрузка…</p>
      ) : (
        <>
          {/* Задачи */}
          <Card label="задачи">
            <p className="whitespace-pre-wrap font-sans text-sm text-ink">
              {data.todoSummary}
            </p>
          </Card>

          {/* Счётчики */}
          <section>
            <SectionLabel>базы</SectionLabel>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <Tile label="новости" value={data.stats.news} />
              <Tile label="посты" value={data.stats.posts} />
              <Tile
                label="rag-чанки"
                value={ragTotal}
                hint={`fixed ${data.stats.ragFixed} · struct ${data.stats.ragStructure} · tg ${data.stats.ragTelegram}`}
              />
              <Tile
                label="tg-сообщения"
                value={data.stats.tgMessages}
                hint={`${data.stats.tgChats} чатов · ${data.stats.tgTopics} топиков`}
              />
              <Tile
                label="dialog-чаты"
                value={data.stats.dialogChats}
                hint={`${data.stats.dialogMessages} сообщений`}
              />
            </div>
          </section>

          {/* Топ-TG */}
          {data.topTg && (
            <section>
              <SectionLabel>{`топ-TG: ${data.chatKey ?? '—'}/${data.topicId}`}</SectionLabel>
              {data.topTg.length === 0 ? (
                <EmptyState
                  title="Нет данных по этому чату/топику."
                  hint="Чат/топик не собран (см. TG collect) или topicId неверен."
                />
              ) : (
                <ul className="divide-y divide-line">
                  {data.topTg.map((m) => (
                    <li key={m.msg_id} className="py-3">
                      <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-dim">
                        <span>#{m.msg_id}</span>
                        <span>{m.from_name}</span>
                        <span>{m.date_iso}</span>
                        {m.reaction_total > 0 && <Badge tone="accent">♥ {m.reaction_total}</Badge>}
                      </div>
                      <p className="mt-1 line-clamp-3 whitespace-pre-wrap font-sans text-sm text-ink">
                        {m.text || '(без текста)'}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
