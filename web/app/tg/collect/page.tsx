// /tg/collect — single-topic MTProto-сбор в tg.sqlite (день 28, web P3b).
// 'use client': форма (chatRef, topicId, limit, reset) → SSE live-прогресс + результат.
// AbortController для отмены. 0 core/ (только web/lib/shared/*).
'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import type { SseTgCollectEvent } from '../../../lib/shared/sse';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

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

const INPUT =
  'rounded border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink placeholder:text-dim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent';

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
        <h1 className="text-xl font-semibold text-ink">TG collect — сбор топика</h1>
        <p className="mt-1 text-sm text-dim">
          MTProto-сбор сообщений forum-топика в <code className="font-mono text-dim">tg.sqlite</code>.
          Зеркало CLI <code className="font-mono text-dim">tg-collect</code>. Прогресс стримится по SSE.
          См. также <Link href="/tg/top" className="text-accent hover:underline">TG-топ</Link> и{' '}
          <Link href="/rag/index-tg" className="text-accent hover:underline">RAG index-tg</Link>.
        </p>
      </section>

      <Card label="Параметры сбора">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 text-sm">
            <span className="block text-xs uppercase tracking-wide text-dim">chatRef</span>
            <input
              className={`mt-1 w-full font-mono text-xs ${INPUT}`}
              value={chatRef}
              onChange={(e) => setChatRef(e.target.value)}
              disabled={running}
              placeholder="@username · -100… · https://t.me/c/<X>/<T>"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-dim">topicId</span>
            <input
              className={`mt-1 w-24 ${INPUT}`}
              value={topicId}
              onChange={(e) => setTopicId(e.target.value)}
              disabled={running}
              placeholder="1"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-dim">лимит</span>
            <input
              className={`mt-1 w-24 ${INPUT}`}
              type="number" min={1} max={5000}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              disabled={running}
              placeholder="вся история"
            />
          </label>
          <label className="flex items-center gap-1 text-sm text-ink">
            <input
              type="checkbox"
              checked={reset}
              onChange={(e) => setReset(e.target.checked)}
              disabled={running}
            />
            <span>--reset (полный re-fetch)</span>
          </label>
          <Button variant="primary" onClick={() => void run()} disabled={running || !chatRef.trim()}>
            {running ? '…' : 'Собрать'}
          </Button>
          <Button variant="ghost" onClick={cancel} disabled={!running}>
            Отмена
          </Button>
        </div>
        <p className="mt-2 text-xs text-dim">
          Требуется настроенный MTProto (api-id/hash и session на сервере в .env). Без topicId —
          ошибка (или задайте URL вида t.me/&lt;chat&gt;/&lt;topicId&gt;).
        </p>
      </Card>

      {error && (
        <p className="rounded-md border border-err/40 bg-err/10 p-2 text-sm text-err">
          {error}
        </p>
      )}

      {start && (
        <Card>
          <p className="text-sm text-ink">
            Чат: <span className="font-medium">{start.chatTitle}</span>{' '}
            <span className="font-mono text-xs text-dim">
              {start.chatKey} / topic {start.topicId}
            </span>
          </p>
        </Card>
      )}

      {(progress.length > 0 || running) && (
        <Card>
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-dim">// Прогресс сбора</span>
            {last && (
              <span className="font-mono text-xs text-dim">
                fetched={last.fetched} · new={last.newlyInserted} · last_id={last.lastId ?? '-'}
              </span>
            )}
          </div>
          {running && (
            <div className="mt-2 flex items-center gap-2 font-mono text-xs text-dim">
              <span
                className="spin inline-block h-3 w-3 rounded-full border border-line-strong border-t-accent"
                aria-hidden
              />
              обновление каждые ~200 сообщений (flush-батч сбора)…
            </div>
          )}
        </Card>
      )}

      {result && (
        <section className="rounded-md border border-ok/40 bg-ok/10 p-4 text-sm">
          <h2 className="font-mono text-xs uppercase tracking-wider text-ok">
            // Готово (mode={result.mode})
          </h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-3">
            <dt className="text-dim">fetched</dt>
            <dd className="tabular-nums text-ink">{result.fetched}</dd>
            <dt className="text-dim">новых</dt>
            <dd className="tabular-nums text-ink">{result.newlyInserted}</dd>
            <dt className="text-dim">updated</dt>
            <dd className="tabular-nums text-ink">{result.updated}</dd>
            <dt className="text-dim">всего в БД</dt>
            <dd className="tabular-nums text-ink">{result.total}</dd>
          </dl>
        </section>
      )}
    </div>
  );
}
