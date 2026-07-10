// /rag — single-shot RAG-query с SSE-стримингом (день 28, web P1).
// 'use client': читает SSE-стрим из /api/rag/query, аккумулирует токены и стадии в
// React-state. Cancel — через AbortController. НИКАКИХ импортов core/ (только shared-типы).
'use client';

import { useCallback, useRef, useState } from 'react';
import type {
  SseEvent,
  SseSource,
  SseQuote,
  SseDebug,
  RagStageStep,
} from '../../lib/shared/sse';
import { useModelPrefDefault } from '../../lib/shared/use-model-pref';

// P1 ограничивает стратегии fixed/structure (документация). 'telegram' добавим в P3
// вместе с chat/topic-фильтром — без фильтра партиция шумная. server-side zod всё ещё
// принимает 'telegram', но UI P1 его не暴露 (и literal "telegram" не попадает в client bundle).
type Strategy = 'fixed' | 'structure';
type Llm = 'local' | 'cloud';

interface StageItem {
  step: RagStageStep;
  detail?: unknown;
}

const STAGE_LABEL: Record<RagStageStep, string> = {
  rewrite: 'переформулировка',
  retrieve: 'поиск',
  filter: 'фильтр',
  rerank: 'реранк',
  guard: 'guard',
  llm: 'генерация',
};

export default function RagPage() {
  const [query, setQuery] = useState('');
  const [strategy, setStrategy] = useState<Strategy>('fixed');
  const [llm, setLlm] = useState<Llm>('local');
  const [noRag, setNoRag] = useState(false);
  const [k, setK] = useState(4);

  const [answer, setAnswer] = useState('');
  const [stages, setStages] = useState<StageItem[]>([]);
  const [sources, setSources] = useState<SseSource[]>([]);
  const [quotes, setQuotes] = useState<SseQuote[]>([]);
  const [debug, setDebug] = useState<SseDebug | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  // follow-up P5: дефолт llm-селектора — из preference (cookie model_pref через /api/settings).
  useModelPrefDefault(setLlm);

  const abortRef = useRef<AbortController | null>(null);

  const reset = (): void => {
    setAnswer('');
    setStages([]);
    setSources([]);
    setQuotes([]);
    setDebug(null);
    setError(null);
  };

  const run = useCallback(async () => {
    if (!query.trim() || running) return;
    reset();
    setRunning(true);
    const ac = new AbortController();
    abortRef.current = ac;

    const handle = (ev: SseEvent): void => {
      switch (ev.type) {
        case 'stage':
          setStages((p) => [...p, { step: ev.step, detail: ev.detail }]);
          break;
        case 'token':
          setAnswer((p) => p + ev.delta);
          break;
        case 'done':
          if (typeof ev.answer === 'string') setAnswer(ev.answer);
          setSources(ev.sources ?? []);
          setQuotes(ev.quotes ?? []);
          setDebug(ev.debug ?? null);
          break;
        case 'error':
          setError(ev.message);
          break;
      }
    };

    try {
      const resp = await fetch('/api/rag/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, strategy, llm, noRag, k }),
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
          const raw = buf.slice(0, sep).trim();
          buf = buf.slice(sep + 2);
          if (!raw.startsWith('data:')) continue;
          const dataLine = raw.slice(5).trim();
          if (!dataLine) continue;
          let ev: SseEvent;
          try {
            ev = JSON.parse(dataLine) as SseEvent;
          } catch {
            continue;
          }
          handle(ev);
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
  }, [query, strategy, llm, noRag, k, running]);

  const cancel = (): void => {
    abortRef.current?.abort();
  };

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold">RAG-запрос</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Вопрос по базе знаний с потоковым ответом и live-стадиями пайплайна.
        </p>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <label className="block text-xs uppercase tracking-wide text-neutral-500">Вопрос</label>
        <textarea
          className="mt-1 w-full resize-y rounded border border-neutral-300 bg-neutral-50 p-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          rows={3}
          placeholder="Например: что такое RAG?"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={running}
        />

        <div className="mt-3 flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">Стратегия</span>
            <select
              className="mt-1 rounded border border-neutral-300 bg-neutral-50 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as Strategy)}
              disabled={running}
            >
              <option value="fixed">fixed</option>
              <option value="structure">structure</option>
            </select>
          </label>

          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">LLM</span>
            <select
              className="mt-1 rounded border border-neutral-300 bg-neutral-50 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              value={llm}
              onChange={(e) => setLlm(e.target.value as Llm)}
              disabled={running}
            >
              <option value="local">local (Ollama)</option>
              <option value="cloud">cloud</option>
            </select>
          </label>

          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">Чанков (k)</span>
            <input
              className="mt-1 w-16 rounded border border-neutral-300 bg-neutral-50 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              type="number"
              min={1}
              max={20}
              value={k}
              onChange={(e) => setK(Number(e.target.value) || 4)}
              disabled={running}
            />
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={noRag}
              onChange={(e) => setNoRag(e.target.checked)}
              disabled={running}
            />
            без RAG (общие знания)
          </label>

          <div className="ml-auto flex gap-2">
            <button
              className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              onClick={run}
              disabled={running || !query.trim()}
            >
              Спросить
            </button>
            <button
              className="rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
              onClick={cancel}
              disabled={!running}
            >
              Отмена
            </button>
          </div>
        </div>
      </section>

      {stages.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Стадии</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {stages.map((s, i) => (
              <span
                key={`${s.step}-${i}`}
                className="rounded-full border border-neutral-300 px-2 py-0.5 text-xs dark:border-neutral-700"
              >
                {STAGE_LABEL[s.step]}
                {s.step === 'llm' && s.detail && typeof s.detail === 'object' && 'topK' in (s.detail as object)
                  ? ` · topK=${(s.detail as { topK: number }).topK}`
                  : ''}
              </span>
            ))}
          </div>
        </section>
      )}

      {error && (
        <section className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </section>
      )}

      {answer && (
        <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Ответ</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm">{answer}</p>
        </section>
      )}

      {(sources.length > 0 || quotes.length > 0 || debug) && (
        <section className="grid gap-4 lg:grid-cols-2">
          {sources.length > 0 && (
            <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
                Источники ({sources.length})
              </h2>
              <ul className="mt-2 space-y-1.5 text-sm">
                {sources.map((s, i) => (
                  <li key={s.chunkId} className="truncate">
                    <span className="text-neutral-400">[{i + 1}]</span>{' '}
                    <span className="font-mono text-xs">{s.source}</span>{' '}
                    <span className="text-xs text-neutral-400">{s.section}</span>{' '}
                    <span className="text-xs text-accent">{s.score.toFixed(3)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {quotes.length > 0 && (
            <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Цитаты</h2>
              <ul className="mt-2 space-y-2 text-sm">
                {quotes.map((q, i) => (
                  <li key={`${q.chunkId}-${i}`}>
                    <div className="text-xs text-neutral-400">
                      {q.source} · {q.section}
                    </div>
                    <div className="whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">{q.snippet}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {debug && (
            <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Отладка</h2>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <dt className="text-neutral-500">pool / filtered</dt>
                <dd className="tabular-nums">
                  {debug.poolSize} / {debug.filteredSize}
                </dd>
                <dt className="text-neutral-500">threshold</dt>
                <dd className="tabular-nums">{debug.threshold}</dd>
                <dt className="text-neutral-500">topK</dt>
                <dd className="tabular-nums">{debug.topK ?? '-'}</dd>
                <dt className="text-neutral-500">rerank</dt>
                <dd>
                  {debug.rerankApplied ? `on (Δ=${debug.rankDelta}${debug.fallback ? ', fallback' : ''})` : 'off'}
                </dd>
                <dt className="text-neutral-500">rewrite</dt>
                <dd>{debug.rewritten ? `on (${debug.effectiveQuery ?? '?'})` : 'off'}</dd>
                <dt className="text-neutral-500">guard</dt>
                <dd>{debug.gaveUp ? 'сработал (не знаю)' : 'нет'}</dd>
              </dl>
            </div>
          )}
        </section>
      )}

      {!running && !answer && !error && stages.length === 0 && (
        <p className="text-sm text-neutral-400">Задайте вопрос и нажмите «Спросить».</p>
      )}
    </div>
  );
}
