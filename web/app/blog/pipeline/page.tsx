'use client';

// /blog/pipeline — FSM блог-pipeline кнопками (день 28, web P4b; гостевой sandbox — meetup-web).
// Текущая стадия + expectedAction + история переходов + кнопки разрешённых переходов
// (allowedTransitions) + reset. Админ: состояние персистит в .data/pipeline-state.json
// (переживает reload). Гость: sandbox-режим — сервер валидирует переходы, но ничего не
// пишет на диск (view.sandbox), историю клиент ведёт сам. Без импортов core/
// (тип стадии — из shared/forms, пояснения стадий — из shared/pipeline-explainer).
import { useCallback, useEffect, useState } from 'react';
import type { PipelineStageInput } from '../../../lib/shared/forms';
import {
  PIPELINE_INTRO,
  PIPELINE_STAGE_EXPLAINER,
} from '../../../lib/shared/pipeline-explainer';
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
  /** Гостевой sandbox: ответ сервера не пишется в боевой pipeline-state.json. */
  sandbox?: boolean;
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
  // Гостевой sandbox: сервер возвращает только последний шаг — полную историю
  // клиент копит сам; на каждой загрузке/reset начинаем с пустой.
  const [localHistory, setLocalHistory] = useState<HistoryEntry[]>([]);

  const load = useCallback(async () => {
    setError(null);
    setLocalHistory([]);
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
        // Гость заявляет свою текущую стадию (`from`) — сервер валидирует переход
        // от псевдосостояния без обращения к боевому файлу.
        const body =
          view?.sandbox === true
            ? { action: 'transition', to, from: view.stage }
            : { action: 'transition', to };
        const r = await fetch('/api/blog/pipeline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `HTTP ${r.status}`);
        }
        const next = (await r.json()) as PipelineView;
        if (next.sandbox && next.history.length > 0) {
          setLocalHistory((prev) => [...prev, ...next.history]);
        }
        setView(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'transition failed');
      } finally {
        setBusy(false);
      }
    },
    [view],
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
      const next = (await r.json()) as PipelineView;
      if (next.sandbox) setLocalHistory([]);
      setView(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'reset failed');
    } finally {
      setBusy(false);
    }
  }, []);

  if (!view) {
    return <p className="text-sm text-dim">{error ?? 'Загрузка…'}</p>;
  }

  // Гость: сервер отвечает только последним шагом — для отображения склеиваем с локальной.
  const histAll = view.sandbox ? [...localHistory, ...view.history] : view.history;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold text-ink">{PIPELINE_INTRO.headline}</h1>
        <p className="mt-1 text-sm text-dim">{PIPELINE_INTRO.text}</p>
      </header>

      {view.sandbox && (
        <p className="rounded-md border border-warn/40 bg-warn/10 p-2 text-sm text-warn">
          Демо-режим: вы управляете копией конвейера — прогресс не сохраняется, другие посетители
          ваших шагов не видят. Войдя как админ, вы управляете боевым состоянием.
        </p>
      )}

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
            const isDone = histAll.some((h) => h.stage === s);
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

      {/* Карта шага под текущей стадией: человеческое «что делает агент» + вход → выход */}
      <Card label="что происходит на этом шаге">
        <p className="text-sm text-ink">{PIPELINE_STAGE_EXPLAINER[view.stage].what}</p>
        <ul className="mt-2 space-y-1 text-sm text-dim">
          <li>
            <span className="font-mono text-xs uppercase tracking-wider text-dim">вход: </span>
            {PIPELINE_STAGE_EXPLAINER[view.stage].inputExample}
          </li>
          <li>
            <span className="font-mono text-xs uppercase tracking-wider text-dim">выход: </span>
            {PIPELINE_STAGE_EXPLAINER[view.stage].outputExample}
          </li>
        </ul>
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
          // История переходов ({histAll.length})
        </h2>
        {histAll.length === 0 ? (
          <p className="text-sm text-dim">Переходов ещё не было.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {histAll
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
