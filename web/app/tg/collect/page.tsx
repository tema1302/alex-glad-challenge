// /tg/collect — single-topic MTProto-сбор в tg.sqlite (день 28, web P3b).
// 'use client': форма (chatRef, topicId, limit, reset) → SSE live-прогресс + результат.
// AbortController для отмены. 0 core/ (только web/lib/shared/*).
'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import type { SseTgCollectEvent } from '../../../lib/shared/sse';

interface ProgressLine {
  fetched: number;
  newlyInserted: number;
  lastId: number | undefined;
}

interface CollectResult {
  mode: string;
  fetched: number;
  newlyInserted: number;
  updated: number;
  total: number;
  chatKey: string;
  topicId: number;
  chatTitle: string;
}

export default function TgCollectPage() {
  const [chatRef, setChatRef] = useState('');
  const [topicId, setTopicId] = useState('');
  const [limit, setLimit] = useState('');
  const [reset, setReset] = useState(false);

  const [progress, setProgress] = useState<ProgressLine[]>([]);
  const [start, setStart] = useState<{ chatKey: string; topicId: number; chatTitle: string } | null>(null);
  const [result, setResult] = useState<CollectResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (): Promise<void> => {
    if (!chatRef.trim() || running) return;
    setRunning(true);
    setError(null);
    setResult(null);
    setStart(null);
    setProgress([]);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const resp = await fetch('/api/tg/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatRef: chatRef.trim(),
          topicId: topicId ? Number(topicId) : undefined,
          limit: limit ? Number(limit) : undefined,
          reset,
        }),
        signal: ac.signal,
      });
      if (!resp.ok || !resp.body) {
        const txt = await resp.text().catch(() => '');
        setError(`HTTP ${resp.status}: ${txt.slice(0, 200)}`);
        return;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf('\n\n')) >= 0) {
          const line = buf.slice(0, sep).trim();
          buf = buf.slice(sep + 2);
          if (!line.startsWith('data:')) continue;
          const dataLine = line.slice(5).trim();
          if (!dataLine) continue;
          let ev: SseTgCollectEvent;
          try {
            ev = JSON.parse(dataLine) as SseTgCollectEvent;
          } catch {
            continue;
          }
          if (ev.type === 'stage' && ev.step === 'start' && ev.detail) {
            setStart({
              chatKey: ev.detail.chatKey ?? '',
              topicId: ev.detail.topicId ?? 0,
              chatTitle: ev.detail.chatTitle ?? '',
            });
          } else if (ev.type === 'stage' && ev.step === 'progress' && ev.detail) {
            setProgress((p) => [
              ...p,
              {
                fetched: ev.detail?.fetched ?? 0,
                newlyInserted: ev.detail?.newlyInserted ?? 0,
                lastId: ev.detail?.lastId,
              },
            ]);
          } else if (ev.type === 'done') {
            setResult({
              mode: ev.mode,
              fetched: ev.fetched,
              newlyInserted: ev.newlyInserted,
              updated: ev.updated,
              total: ev.total,
              chatKey: ev.chatKey,
              topicId: ev.topicId,
              chatTitle: ev.chatTitle,
            });
          } else if (ev.type === 'error') {
            setError(ev.message);
          }
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setError('Отменено');
      } else {
        setError(e instanceof Error ? e.message : 'request failed');
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [chatRef, topicId, limit, reset, running]);

  const cancel = (): void => {
    abortRef.current?.abort();
  };

  const last = progress[progress.length - 1];

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold">TG collect — сбор топика</h1>
        <p className="mt-1 text-sm text-neutral-500">
          MTProto-сбор сообщений forum-топика в <code className="font-mono">tg.sqlite</code>.
          Зеркало CLI <code className="font-mono">tg-collect</code>. Прогресс стримится по SSE.
          См. также <Link href="/tg/top" className="text-accent hover:underline">TG-топ</Link> и{' '}
          <Link href="/rag/index-tg" className="text-accent hover:underline">RAG index-tg</Link>.
        </p>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 text-sm">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">chatRef</span>
            <input
              className="mt-1 w-full rounded border border-neutral-300 bg-neutral-50 px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950"
              value={chatRef}
              onChange={(e) => setChatRef(e.target.value)}
              disabled={running}
              placeholder="@username · -100… · https://t.me/c/<X>/<T>"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">topicId</span>
            <input
              className="mt-1 w-24 rounded border border-neutral-300 bg-neutral-50 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              value={topicId}
              onChange={(e) => setTopicId(e.target.value)}
              disabled={running}
              placeholder="1"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">лимит</span>
            <input
              className="mt-1 w-24 rounded border border-neutral-300 bg-neutral-50 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              type="number" min={1} max={5000}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              disabled={running}
              placeholder="вся история"
            />
          </label>
          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={reset}
              onChange={(e) => setReset(e.target.checked)}
              disabled={running}
            />
            <span>--reset (полный re-fetch)</span>
          </label>
          <button
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            onClick={() => void run()}
            disabled={running || !chatRef.trim()}
          >
            {running ? '…' : 'Собрать'}
          </button>
          <button
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
            onClick={cancel}
            disabled={!running}
          >
            Отмена
          </button>
        </div>
        <p className="mt-2 text-xs text-neutral-400">
          Требуется настроенный MTProto (api-id/hash и session на сервере в .env). Без topicId —
          ошибка (или задайте URL вида t.me/&lt;chat&gt;/&lt;topicId&gt;).
        </p>
      </section>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {start && (
        <section className="rounded-lg border border-neutral-200 bg-white p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
          <p>
            Чат: <span className="font-medium">{start.chatTitle}</span>{' '}
            <span className="font-mono text-xs text-neutral-400">
              {start.chatKey} / topic {start.topicId}
            </span>
          </p>
        </section>
      )}

      {(progress.length > 0 || running) && (
        <section className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Прогресс сбора</h2>
            {last && (
              <span className="font-mono text-xs text-neutral-400">
                fetched={last.fetched} · new={last.newlyInserted} · last_id={last.lastId ?? '-'}
              </span>
            )}
          </div>
          {running && (
            <p className="mt-1 text-xs text-neutral-400">
              обновление каждые ~200 сообщений (flush-батч сбора)…
            </p>
          )}
        </section>
      )}

      {result && (
        <section className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm dark:border-emerald-800 dark:bg-emerald-950">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
            Готово (mode={result.mode})
          </h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-3">
            <dt className="text-neutral-500">fetched</dt>
            <dd className="tabular-nums">{result.fetched}</dd>
            <dt className="text-neutral-500">новых</dt>
            <dd className="tabular-nums">{result.newlyInserted}</dd>
            <dt className="text-neutral-500">updated</dt>
            <dd className="tabular-nums">{result.updated}</dd>
            <dt className="text-neutral-500">всего в БД</dt>
            <dd className="tabular-nums">{result.total}</dd>
          </dl>
        </section>
      )}
    </div>
  );
}
