'use client';

// /blog/pipeline — FSM блог-pipeline кнопками (день 28, web P4b).
// Текущая стадия + expectedAction + история переходов + кнопки разрешённых переходов
// (allowedTransitions) + reset. Состояние персистит в .data/pipeline-state.json →
// переживает reload. Без импортов core/ (тип стадии — из shared/forms).
import { useCallback, useEffect, useState } from 'react';
import type { PipelineStageInput } from '../../../lib/shared/forms';

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
    return <p className="text-sm text-neutral-500">{error ?? 'Загрузка…'}</p>;
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Блог-pipeline (FSM)</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Конечный автомат блог-агентов. Переходы валидируются core/stateMachine —
          недопустимые шаги возвращают 400. Состояние живёт в pipeline-state.json.
        </p>
      </header>

      <section className="rounded border border-neutral-200 p-4 dark:border-neutral-800">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-xs uppercase text-neutral-500">Стадия</span>
          <strong className="text-base">{view.labels[view.stage]}</strong>
          <span className="text-xs text-neutral-500">
            code: <code>{view.stage}</code>
          </span>
          {view.revisionCount > 0 && (
            <span className="text-xs text-neutral-500">правок: {view.revisionCount}</span>
          )}
        </div>
        <p className="mt-2 text-sm">
          <span className="text-neutral-500">Ожидаемое действие: </span>
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
                    ? 'bg-accent text-white'
                    : isDone
                      ? 'bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200'
                      : 'bg-neutral-100 text-neutral-400 dark:bg-neutral-900',
                ].join(' ')}
              >
                {view.labels[s]}
              </li>
            );
          })}
        </ol>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium">Разрешённые переходы</h2>
        {view.allowed.length === 0 ? (
          <p className="text-sm text-neutral-500">Из этой стадии нет переходов.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {view.allowed.map((to) => (
              <button
                key={to}
                type="button"
                disabled={busy}
                onClick={() => transition(to)}
                className="rounded border border-accent px-3 py-1.5 text-sm text-accent hover:bg-accent hover:text-white disabled:opacity-50"
              >
                → {view.labels[to]}
              </button>
            ))}
          </div>
        )}
        <div className="mt-3">
          <button
            type="button"
            disabled={busy || view.stage === 'idle'}
            onClick={reset}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            Сбросить в idle
          </button>
        </div>
      </section>

      {error && (
        <p className="rounded bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium">История переходов ({view.history.length})</h2>
        {view.history.length === 0 ? (
          <p className="text-sm text-neutral-500">Переходов ещё не было.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {view.history
              .slice()
              .reverse()
              .map((h, i) => (
                <li key={i} className="font-mono text-neutral-600 dark:text-neutral-400">
                  <span className="text-neutral-400">
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
