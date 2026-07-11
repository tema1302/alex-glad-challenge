// /rag/index-tg — индексация telegram в rag.sqlite (день 28, web P3b).
// 'use client': форма (chatRef, topicId, reset, limit, top) → SSE. ⚠️ LANDMINE:
// single-topic (topicId задан) + reset сносит ВСЮ telegram-партицию — красный warning
// + обязательный confirm-чекбокс. 0 core/ (только web/lib/shared/*).
'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import type { SseRagIndexTgEvent } from '../../../lib/shared/sse';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

interface ProgressLine {
  label: string;
  detail: string;
}

interface IndexResult {
  mode: 'single' | 'whole';
  chatKey: string;
  indexed: number;
  total: number;
  dim: number | null;
}

const INPUT =
  'rounded border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink placeholder:text-dim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent';

export default function RagIndexTgPage() {
  const [chatRef, setChatRef] = useState('');
  const [topicId, setTopicId] = useState('');
  const [reset, setReset] = useState(false);
  const [limit, setLimit] = useState('');
  const [top, setTop] = useState('');
  const [confirmChecked, setConfirmChecked] = useState(false);

  const [progress, setProgress] = useState<ProgressLine[]>([]);
  const [result, setResult] = useState<IndexResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // single-topic = задан topicId. Только в этом режиме активен деструктивный reset-clobber.
  const isSingle = topicId.trim() !== '' && Number.isFinite(Number(topicId));
  const destructive = isSingle && reset;

  const run = useCallback(async (): Promise<void> => {
    if (!chatRef.trim() || running) return;
    // Деструктивный reset требует подтверждения (красный чекбокс).
    if (destructive && !confirmChecked) return;
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress([]);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const resp = await fetch('/api/rag/index-tg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatRef: chatRef.trim(),
          topicId: topicId ? Number(topicId) : undefined,
          reset,
          limit: limit ? Number(limit) : undefined,
          top: top ? Number(top) : undefined,
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
          let ev: SseRagIndexTgEvent;
          try {
            ev = JSON.parse(dataLine) as SseRagIndexTgEvent;
          } catch {
            continue;
          }
          if (ev.type === 'stage') {
            const d = ev.detail ?? {};
            let label: string = ev.step;
            let detail = '';
            if (ev.step === 'start') {
              label = 'старт';
              detail = `${d.mode ?? ''} ${d.chatKey ?? ''}${d.topicId != null ? ` / topic ${d.topicId}` : ''}`;
            } else if (ev.step === 'collect') {
              label = 'сбор';
              detail =
                d.mode ??
                (d.topicId != null ? `topic ${d.topicId}` : '');
            } else if (ev.step === 'progress') {
              label = 'прогресс';
              detail =
                (d.indexed != null && d.total != null)
                  ? `indexed ${d.indexed}/${d.total}`
                  : (d.fetched != null ? `fetched=${d.fetched} new=${d.newlyInserted ?? 0}` : '');
            } else if (ev.step === 'clear') {
              label = 'очистка';
              detail = d.cleared != null ? `удалено ${d.cleared} чанков` : '';
            }
            setProgress((p) => [...p, { label, detail }]);
          } else if (ev.type === 'done') {
            setResult({
              mode: ev.mode,
              chatKey: ev.chatKey,
              indexed: ev.indexed,
              total: ev.total,
              dim: ev.dim,
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
  }, [chatRef, topicId, reset, limit, top, destructive, confirmChecked, running]);

  const cancel = (): void => {
    abortRef.current?.abort();
  };

  const canRun = !!chatRef.trim() && (!destructive || confirmChecked);

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold text-ink">RAG index-tg — telegram</h1>
        <p className="mt-1 text-sm text-dim">
          Индексация собранного TG-контента в <code className="font-mono text-ink">rag.sqlite</code>. Зеркало CLI{' '}
          <code className="font-mono text-ink">rag index-tg</code>. Перед этим —{' '}
          <Link href="/tg/collect" className="text-accent hover:underline">TG collect</Link>.
        </p>
      </section>

      {/* КРАСНЫЙ WARNING — landmine single-topic clobber */}
      <section className="rounded-md border-2 border-err/60 bg-err/10 p-4">
        <h2 className="text-sm font-semibold text-err">
          ⚠️ Осторожно: single-topic index-tg может снести telegram-партицию
        </h2>
        <p className="mt-1 text-sm text-err">
          Если задан <strong>topicId</strong> (single-topic) и отмечен <strong>--reset</strong>,
          будет вызвана <code className="font-mono">clearStrategy('telegram')</code> — она удалит
          <strong> ВСЕ чанки стратегии telegram</strong> (все чаты и топики, не только этот).
          Это известный cli-баг (memory). Без <code className="font-mono">topicId</code> (whole-chat)
          чистится только выбранный чат — безопаснее.
        </p>
        {destructive ? (
          <label className="mt-3 flex items-start gap-2 rounded border border-err/60 bg-surface p-2 text-sm">
            <input
              type="checkbox"
              checked={confirmChecked}
              onChange={(e) => setConfirmChecked(e.target.checked)}
              disabled={running}
              className="mt-0.5"
            />
            <span className="text-err">
              Я понимаю: single-topic + --reset удалит всю telegram-партицию перед индексацией.
              Требуется явное подтверждение.
            </span>
          </label>
        ) : (
          <p className="mt-2 text-xs text-err">
            Текущий режим: <strong>{isSingle ? 'single-topic без reset' : 'whole-chat'}</strong> —
            деструктивной очистки партиции не будет.
          </p>
        )}
      </section>

      <Card label="Параметры">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 text-sm">
            <span className="block text-xs uppercase tracking-wide text-dim">chatRef</span>
            <input
              className={`mt-1 w-full font-mono text-xs ${INPUT}`}
              value={chatRef}
              onChange={(e) => setChatRef(e.target.value)}
              disabled={running}
              placeholder="@username · -100… · URL t.me/c/<X>/<T>"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-dim">topicId</span>
            <input
              className={`mt-1 w-24 ${INPUT}`}
              value={topicId}
              onChange={(e) => setTopicId(e.target.value)}
              disabled={running}
              placeholder="пусто = whole-chat"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-dim">лимит collect</span>
            <input
              className={`mt-1 w-24 ${INPUT}`}
              type="number" min={1} max={5000}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              disabled={running}
              placeholder="вся"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-dim">top-N</span>
            <input
              className={`mt-1 w-24 ${INPUT}`}
              type="number" min={1} max={5000}
              value={top}
              onChange={(e) => setTop(e.target.value)}
              disabled={running}
              placeholder={isSingle ? 'все' : '1500'}
            />
          </label>
          <label className={`flex items-center gap-1 text-sm text-ink ${destructive ? 'font-medium text-err' : ''}`}>
            <input
              type="checkbox"
              checked={reset}
              onChange={(e) => {
                setReset(e.target.checked);
                setConfirmChecked(false);
              }}
              disabled={running}
            />
            <span>--reset {destructive && '⚠️'}</span>
          </label>
          <Button variant="primary" onClick={() => void run()} disabled={running || !canRun}>
            {running ? '…' : 'Индексировать'}
          </Button>
          <Button variant="ghost" onClick={cancel} disabled={!running}>
            Отмена
          </Button>
        </div>
        <p className="mt-2 text-xs text-dim">
          Режим: <strong className="text-ink">{isSingle ? 'single-topic' : 'whole-chat'}</strong>
          {isSingle
            ? reset
              ? ' · ⚠️ clearStrategy(telegram) — весь раздел будет перезаписан'
              : ' · аддитивный INSERT (без очистки; повтор даст дубликаты)'
            : ' · clearBySourcePrefix (только этот чат)'}
          .
        </p>
      </Card>

      {error && (
        <p className="rounded border border-err/40 bg-err/10 p-2 text-sm text-err">{error}</p>
      )}

      {(progress.length > 0 || running) && (
        <Card label="Лог операции">
          <ul className="space-y-1 font-mono text-xs text-ink">
            {progress.map((p, i) => (
              <li key={i}>
                <span className="text-dim">[{p.label}]</span> {p.detail}
              </li>
            ))}
            {running && (
              <li className="flex items-center gap-2 text-dim">
                <span
                  className="spin inline-block h-3 w-3 rounded-full border border-line-strong border-t-accent"
                  aria-hidden
                />
                выполняется…
              </li>
            )}
          </ul>
        </Card>
      )}

      {result && (
        <section className="rounded-md border border-ok/40 bg-ok/10 p-4 text-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ok">
            Готово (mode={result.mode})
          </h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-3">
            <dt className="text-dim">чат</dt>
            <dd className="font-mono text-ink">{result.chatKey}</dd>
            <dt className="text-dim">индексировано</dt>
            <dd className="tabular-nums text-ink">{result.indexed}</dd>
            <dt className="text-dim">всего в telegram</dt>
            <dd className="tabular-nums text-ink">{result.total}</dd>
            <dt className="text-dim">dim</dt>
            <dd className="tabular-nums text-ink">{result.dim ?? '-'}</dd>
          </dl>
        </section>
      )}
    </div>
  );
}
