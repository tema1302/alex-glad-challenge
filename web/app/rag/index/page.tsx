// /rag/index — индексация docs (fixed/structure) в rag.sqlite (день 28, web P3b).
// 'use client': выбор стратегий → confirm → SSE start→done. Предупреждение о перезаписи.
// 0 core/ (только web/lib/shared/*).
'use client';

import { useCallback, useRef, useState } from 'react';
import type { SseRagIndexEvent, SseRagIndexStrategyStat } from '../../../lib/shared/sse';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

type Strategy = 'fixed' | 'structure';

export default function RagIndexPage() {
  const [strategies, setStrategies] = useState<Strategy[]>(['fixed']);
  const [confirmChecked, setConfirmChecked] = useState(false);

  const [start, setStart] = useState<{ docsDir: string; strategies: string[] } | null>(null);
  const [result, setResult] = useState<SseRagIndexStrategyStat[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const toggle = (s: Strategy): void => {
    setStrategies((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));
  };

  const run = useCallback(async (): Promise<void> => {
    if (running || strategies.length === 0 || !confirmChecked) return;
    setRunning(true);
    setError(null);
    setResult(null);
    setStart(null);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const resp = await fetch('/api/rag/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategies }),
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
          let ev: SseRagIndexEvent;
          try {
            ev = JSON.parse(dataLine) as SseRagIndexEvent;
          } catch {
            continue;
          }
          if (ev.type === 'stage' && ev.detail) {
            setStart({ docsDir: ev.detail.docsDir ?? '', strategies: ev.detail.strategies ?? [] });
          } else if (ev.type === 'done') {
            setResult(ev.result);
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
  }, [strategies, confirmChecked, running]);

  const cancel = (): void => {
    abortRef.current?.abort();
  };

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold text-ink">RAG index — документы</h1>
        <p className="mt-1 text-sm text-dim">
          Переиндексация <code className="font-mono text-ink">challenge/src/data/rag-sample</code> в{' '}
          <code className="font-mono text-ink">rag.sqlite</code>. Зеркало CLI{' '}
          <code className="font-mono text-ink">rag index</code>.
        </p>
      </section>

      <section className="rounded-md border border-warn/40 bg-warn/10 p-3 text-sm">
        <p className="font-medium text-warn">⚠️ Переиндексация</p>
        <p className="mt-1 text-warn">
          Каждая выбранная стратегия будет очищена (<code className="font-mono">clearStrategy</code>) и
          пересобрана заново. Это затрёт существующие чанки по этим стратегиям. Операция длительная
          (эмбеддинги), стримится в console сервера.
        </p>
      </section>

      <Card label="Стратегии">
        <div className="space-y-2">
          {(['fixed', 'structure'] as Strategy[]).map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={strategies.includes(s)}
                onChange={() => toggle(s)}
                disabled={running}
              />
              <span className="font-mono">{s}</span>
            </label>
          ))}
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={confirmChecked}
            onChange={(e) => setConfirmChecked(e.target.checked)}
            disabled={running}
          />
          <span>Понимаю: индексы выбранных стратегий будут перезаписаны.</span>
        </label>
        <div className="mt-4 flex gap-2">
          <Button variant="primary" onClick={() => void run()} disabled={running || strategies.length === 0 || !confirmChecked}>
            {running ? '…' : 'Индексировать'}
          </Button>
          <Button variant="ghost" onClick={cancel} disabled={!running}>
            Отмена
          </Button>
        </div>
      </Card>

      {error && (
        <p className="rounded border border-err/40 bg-err/10 p-2 text-sm text-err">{error}</p>
      )}

      {running && (
        <Card>
          <div className="flex items-center gap-2 font-mono text-xs text-dim">
            <span
              className="spin inline-block h-3 w-3 rounded-full border border-line-strong border-t-accent"
              aria-hidden
            />
            индексация…
          </div>
        </Card>
      )}

      {start && (
        <section className="rounded-md border border-line bg-surface p-3 text-xs">
          <p className="text-dim">
            Документы: <span className="font-mono text-ink">{start.docsDir}</span>
          </p>
          <p className="text-dim">
            Стратегии: <span className="text-ink">{start.strategies.join(', ')}</span> {running && '· индексация…'}
          </p>
        </section>
      )}

      {result && (
        <section className="rounded-md border border-ok/40 bg-ok/10 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ok">Готово</h2>
          <div className="overflow-x-auto">
            <table className="mt-2 w-full text-xs">
              <thead>
                <tr className="text-left text-dim">
                  <th className="py-1 pr-3">стратегия</th>
                  <th className="py-1 pr-3">чанков</th>
                  <th className="py-1 pr-3">среднее симв</th>
                  <th className="py-1">dim</th>
                </tr>
              </thead>
              <tbody>
                {result.map((r) => (
                  <tr key={r.strategy} className="tabular-nums text-ink">
                    <td className="py-1 pr-3 font-mono">{r.strategy}</td>
                    <td className="py-1 pr-3">{r.chunks}</td>
                    <td className="py-1 pr-3">{r.avgLen}</td>
                    <td className="py-1">{r.dim ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
