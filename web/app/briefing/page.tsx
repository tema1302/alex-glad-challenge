// /briefing — read-only сводка системы. web P3a.
// 'use client': GET /api/briefing (todos + stats, всегда) + опц. chatKey/topicId → топ-TG.
// БЕЗ publish в TG (P3b). Просто витрина-сводка.
'use client';

import { useCallback, useEffect, useState } from 'react';

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
      <section>
        <h1 className="text-xl font-semibold">Сводка</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Текущее состояние: ожидающие задачи, счётчики баз, топ-TG (по chatKey). Только чтение.
        </p>
      </section>

      {/* Топ-TG по chatKey (опц.) */}
      <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Топ-TG по чату</h2>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="flex-1 text-sm">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">chatKey</span>
            <input
              className="mt-1 w-full rounded border border-neutral-300 bg-neutral-50 px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950"
              value={chatKey} onChange={(e) => setChatKey(e.target.value)}
              placeholder="-1001234567890 (пусто — без топ-TG)"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">topicId</span>
            <input
              className="mt-1 w-24 rounded border border-neutral-300 bg-neutral-50 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              value={topicId} onChange={(e) => setTopicId(e.target.value)}
            />
          </label>
          <button
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white"
            onClick={() => void load(chatKey, topicId)}
          >
            обновить
          </button>
        </div>
      </section>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {!data ? (
        <p className="text-sm text-neutral-400">Загрузка…</p>
      ) : (
        <>
          {/* Задачи */}
          <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Задачи</h2>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-neutral-700 dark:text-neutral-300">
              {data.todoSummary}
            </pre>
          </section>

          {/* Счётчики */}
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Базы</h2>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <Stat label="Новости" value={data.stats.news} />
              <Stat label="Посты" value={data.stats.posts} />
              <Stat label="RAG-чанки" value={ragTotal} hint={`fixed ${data.stats.ragFixed} · struct ${data.stats.ragStructure} · tg ${data.stats.ragTelegram}`} />
              <Stat label="TG-сообщения" value={data.stats.tgMessages} hint={`${data.stats.tgChats} чатов · ${data.stats.tgTopics} топиков`} />
              <Stat label="Dialog-чаты" value={data.stats.dialogChats} hint={`${data.stats.dialogMessages} сообщений`} />
            </div>
          </section>

          {/* Топ-TG */}
          {data.topTg && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
                Топ-TG: {data.chatKey}/{data.topicId}
              </h2>
              {data.topTg.length === 0 ? (
                <p className="mt-2 text-sm text-neutral-400">
                  Нет данных по этому chatKey/topicId (collect — P3b, либо topicId неверен).
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {data.topTg.map((m) => (
                    <li key={m.msg_id} className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                        <span className="font-mono">#{m.msg_id}</span>
                        <span>{m.from_name}</span>
                        <span>{m.date_iso}</span>
                        {m.reaction_total > 0 && (
                          <span className="rounded-full border border-amber-300 px-2 py-0.5 text-amber-700 dark:border-amber-700 dark:text-amber-400">♥ {m.reaction_total}</span>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">{m.text || '(без текста)'}</p>
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

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="mt-0.5 text-[10px] text-neutral-400">{hint}</div> : null}
    </div>
  );
}
