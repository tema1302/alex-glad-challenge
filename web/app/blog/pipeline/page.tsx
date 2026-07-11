'use client';

// /blog/pipeline — FSM блог-pipeline кнопками (день 28, web P4b).
// Текущая стадия + expectedAction + история переходов + кнопки разрешённых переходов
// (allowedTransitions) + reset. Состояние персистит в .data/pipeline-state.json →
// переживает reload. Без импортов core/ (тип стадии — из shared/forms).
import { useCallback, useEffect, useState } from 'react';
import type { PipelineStageInput } from '../../../lib/shared/forms';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

interface HistoryEntry {
  stage: PipelineStageInput;
  step: string;
  timestamp: string;
  detail: string;
}

interface PipelineView {
  stage: PipelineStageInput;
  step: string;
  expectedAction: string;
  allowed: PipelineStageInput[];
  revisionCount: number;
  history: HistoryEntry[];
  labels: Record<PipelineStageInput, string>;
}

const STAGE_ORDER: PipelineStageInput[] = [
  'idle',
  'planning',
  'execution',
  'validation',
  'revision',
  'done',
];

export default function PipelinePage() {
  const [view, setView] = useState<PipelineView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch('/api/blog/pipeline', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setView((await r.json()) as PipelineView);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const transition = useCallback(
    async (to: PipelineStageInput) => {
      setBusy(true);
      setError(null);
      try {
        const r = await fetch('/api/blog/pipeline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'transition', to }),
        });
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `HTTP ${r.status}`);
        }
        setView((await r.json()) as PipelineView);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'transition failed');
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const reset = useCallback(async () => {
    if (!window.confirm('Сбросить pipeline в idle? История переходов сохранится в логе.')) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/blog/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setView((await r.json()) as PipelineView);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'reset failed');
    } finally {
      setBusy(false);
    }
  }, []);

  if (!view) {
    return <p className="text-sm text-dim">{error ?? 'Загрузка…'}</p>;
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold text-ink">Блог-pipeline (FSM)</h1>
        <p className="mt-1 text-sm text-dim">
          Конечный автомат блог-агентов. Переходы валидируются core/stateMachine —
          недопустимые шаги возвращают 400. Состояние живёт в pipeline-state.json.
        </p>
      </header>

      <Card>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-xs uppercase text-dim">Стадия</span>
          <strong className="text-base text-ink">{view.labels[view.stage]}</strong>
          <span className="text-xs text-dim">
            code: <code className="font-mono text-dim">{view.stage}</code>
          </span>
          {view.revisionCount > 0 && (
            <span className="text-xs text-dim">правок: {view.revisionCount}</span>
          )}
        </div>
        <p className="mt-2 text-sm text-ink">
          <span className="text-dim">Ожидаемое действие: </span>
          {view.expectedAction}
        </p>

        {/* Прогресс-лента 6 стадий */}
        <ol className="mt-3 flex flex-wrap gap-2 text-xs">
          {STAGE_ORDER.map((s) => {
            const isCurrent = s === view.stage;
            const isDone = view.history.some((h) => h.stage === s);
            return (
              <li
                key={s}
                className={[
                  'rounded px-2 py-1',
                  isCurrent
                    ? 'bg-accent text-accent-ink'
                    : isDone
                      ? 'border border-line-strong text-dim'
                      : 'border border-line text-dim opacity-60',
                ].join(' ')}
              >
                {view.labels[s]}
              </li>
            );
          })}
        </ol>
      </Card>

      <section>
        <h2 className="mb-2 font-mono text-xs uppercase tracking-wider text-dim">// Разрешённые переходы</h2>
        {view.allowed.length === 0 ? (
          <p className="text-sm text-dim">Из этой стадии нет переходов.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {view.allowed.map((to) => (
              <Button key={to} variant="ghost" disabled={busy} onClick={() => transition(to)}>
                → {view.labels[to]}
              </Button>
            ))}
          </div>
        )}
        <div className="mt-3">
          <Button variant="ghost" disabled={busy || view.stage === 'idle'} onClick={reset}>
            Сбросить в idle
          </Button>
        </div>
      </section>

      {error && (
        <p className="rounded-md border border-err/40 bg-err/10 p-2 text-sm text-err">
          {error}
        </p>
      )}

      <section>
        <h2 className="mb-2 font-mono text-xs uppercase tracking-wider text-dim">
          // История переходов ({view.history.length})
        </h2>
        {view.history.length === 0 ? (
          <p className="text-sm text-dim">Переходов ещё не было.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {view.history
              .slice()
              .reverse()
              .map((h, i) => (
                <li key={i} className="font-mono text-dim">
                  <span className="opacity-70">
                    {new Date(h.timestamp).toLocaleTimeString()}
                  </span>{' '}
                  {h.step}
                  {h.detail ? ` — ${h.detail}` : ''}
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  );
}
