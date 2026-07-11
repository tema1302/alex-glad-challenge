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
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { SectionLabel } from '../components/ui/SectionLabel';

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

const INPUT =
  'rounded border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink placeholder:text-dim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent';

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
        <h1 className="text-xl font-semibold text-ink">RAG-запрос</h1>
        <p className="mt-1 text-sm text-dim">
          Вопрос по базе знаний с потоковым ответом и live-стадиями пайплайна.
        </p>
      </section>

      <Card label="Вопрос">
        <textarea
          className={`mt-1 w-full resize-y ${INPUT} p-2`}
          rows={3}
          placeholder="Например: что такое RAG?"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={running}
        />

        <div className="mt-3 flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-dim">Стратегия</span>
            <select
              className={`mt-1 ${INPUT}`}
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as Strategy)}
              disabled={running}
            >
              <option value="fixed">fixed</option>
              <option value="structure">structure</option>
            </select>
          </label>

          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-dim">LLM</span>
            <select
              className={`mt-1 ${INPUT}`}
              value={llm}
              onChange={(e) => setLlm(e.target.value as Llm)}
              disabled={running}
            >
              <option value="local">local (Ollama)</option>
              <option value="cloud">cloud</option>
            </select>
          </label>

          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-dim">Чанков (k)</span>
            <input
              className={`mt-1 w-16 ${INPUT}`}
              type="number"
              min={1}
              max={20}
              value={k}
              onChange={(e) => setK(Number(e.target.value) || 4)}
              disabled={running}
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={noRag}
              onChange={(e) => setNoRag(e.target.checked)}
              disabled={running}
            />
            без RAG (общие знания)
          </label>

          <div className="ml-auto flex gap-2">
            <Button variant="primary" onClick={run} disabled={running || !query.trim()}>
              Спросить
            </Button>
            <Button variant="ghost" onClick={cancel} disabled={!running}>
              Отмена
            </Button>
          </div>
        </div>
      </Card>

      {running && (
        <Card>
          <div className="flex items-center gap-2 font-mono text-xs text-dim">
            <span
              className="spin inline-block h-3 w-3 rounded-full border border-line-strong border-t-accent"
              aria-hidden
            />
            выполняется…
          </div>
        </Card>
      )}

      {stages.length > 0 && (
        <section>
          <SectionLabel>Стадии</SectionLabel>
          <div className="mt-2 flex flex-wrap gap-2">
            {stages.map((s, i) => (
              <span
                key={`${s.step}-${i}`}
                className="rounded-full border border-line px-2 py-0.5 text-xs text-dim"
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
        <section className="rounded-md border border-err/40 bg-err/10 p-3 text-sm text-err">
          {error}
        </section>
      )}

      {answer && (
        <Card label="Ответ">
          <p className="whitespace-pre-wrap text-sm text-ink">{answer}</p>
        </Card>
      )}

      {(sources.length > 0 || quotes.length > 0 || debug) && (
        <section className="grid gap-4 lg:grid-cols-2">
          {sources.length > 0 && (
            <Card label={`Источники (${sources.length})`}>
              <ul className="space-y-1.5 text-sm">
                {sources.map((s, i) => (
                  <li key={s.chunkId} className="truncate">
                    <span className="text-dim">[{i + 1}]</span>{' '}
                    <span className="font-mono text-xs text-ink">{s.source}</span>{' '}
                    <span className="text-xs text-dim">{s.section}</span>{' '}
                    <span className="text-xs text-accent">{s.score.toFixed(3)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {quotes.length > 0 && (
            <Card label="Цитаты">
              <ul className="space-y-2 text-sm">
                {quotes.map((q, i) => (
                  <li key={`${q.chunkId}-${i}`}>
                    <div className="text-xs text-dim">
                      {q.source} · {q.section}
                    </div>
                    <div className="whitespace-pre-wrap text-ink">{q.snippet}</div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {debug && (
            <Card label="Отладка">
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <dt className="text-dim">pool / filtered</dt>
                <dd className="tabular-nums text-ink">
                  {debug.poolSize} / {debug.filteredSize}
                </dd>
                <dt className="text-dim">threshold</dt>
                <dd className="tabular-nums text-ink">{debug.threshold}</dd>
                <dt className="text-dim">topK</dt>
                <dd className="tabular-nums text-ink">{debug.topK ?? '-'}</dd>
                <dt className="text-dim">rerank</dt>
                <dd className="text-ink">
                  {debug.rerankApplied ? `on (Δ=${debug.rankDelta}${debug.fallback ? ', fallback' : ''})` : 'off'}
                </dd>
                <dt className="text-dim">rewrite</dt>
                <dd className="text-ink">{debug.rewritten ? `on (${debug.effectiveQuery ?? '?'})` : 'off'}</dd>
                <dt className="text-dim">guard</dt>
                <dd className="text-ink">{debug.gaveUp ? 'сработал (не знаю)' : 'нет'}</dd>
              </dl>
            </Card>
          )}
        </section>
      )}

      {!running && !answer && !error && stages.length === 0 && (
        <p className="text-sm text-dim">Задайте вопрос и нажмите «Спросить».</p>
      )}
    </div>
  );
}
