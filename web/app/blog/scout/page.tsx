// /blog/scout — 3 source-агента (RSS/Forum/TG) → оркестратор (день 28, web P4b).
// 'use client': форма (query/hours/topK/Forum/TG/llm) → SSE (start → done/error).
// runSourceAgents без onProgress → прогресс = индикатор «работаю». В done — финальный топ
// оркестратора + сводка по агентам. НИКАКИХ импортов core/.
'use client';

import { useCallback, useRef, useState } from 'react';
import type { SseBlogScoutEvent } from '../../../lib/shared/sse';

type Llm = 'local' | 'cloud';

interface RankedTopic {
  title: string;
  source: string;
  hypeScore: number;
  hypeReason: string;
  orchestratorScore: number;
  orchestratorReason: string;
  url: string | null;
}
interface AgentSummary {
  agent: string;
  count: number;
  error: string | null;
}

export default function BlogScoutPage() {
  const [query, setQuery] = useState('');
  const [hours, setHours] = useState(24);
  const [topK, setTopK] = useState(3);
  const [enableForum, setEnableForum] = useState(true);
  const [enableTelegram, setEnableTelegram] = useState(false);
  const [llm, setLlm] = useState<Llm>('cloud');

  const [running, setRunning] = useState(false);
  const [ranked, setRanked] = useState<RankedTopic[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const reset = (): void => {
    setRanked([]);
    setAgents([]);
    setError(null);
  };

  const run = useCallback(async () => {
    if (running) return;
    reset();
    setRunning(true);
    const ac = new AbortController();
    abortRef.current = ac;

    const handle = (ev: SseBlogScoutEvent): void => {
      switch (ev.type) {
        case 'stage':
          break;
        case 'done':
          setRanked(ev.ranked);
          setAgents(ev.agents);
          break;
        case 'error':
          setError(ev.message);
          break;
      }
    };

    try {
      const resp = await fetch('/api/blog/scout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hours,
          topK,
          query: query.trim() || undefined,
          enableForum,
          enableTelegram,
          llm,
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
          const raw = buf.slice(0, sep).trim();
          buf = buf.slice(sep + 2);
          if (!raw.startsWith('data:')) continue;
          const dataLine = raw.slice(5).trim();
          if (!dataLine) continue;
          let ev: SseBlogScoutEvent;
          try {
            ev = JSON.parse(dataLine) as SseBlogScoutEvent;
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
  }, [query, hours, topK, enableForum, enableTelegram, llm, running]);

  const cancel = (): void => {
    abortRef.current?.abort();
  };

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold">Scout (3 source-агента)</h1>
        <p className="mt-1 text-sm text-neutral-500">
          RSS + Forum (+ TG по выбору) собирают темы параллельно, оркестратор (LLM) выбирает
          финальный топ. Это этап&nbsp;1 пайплайна — без написания поста.
        </p>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex-1 min-w-[200px] text-sm">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">Запрос</span>
            <input
              className="mt-1 w-full rounded border border-neutral-300 bg-neutral-50 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              type="text"
              placeholder="самые горячие футбольные новости"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={running}
            />
          </label>

          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">Часов</span>
            <input
              className="mt-1 w-20 rounded border border-neutral-300 bg-neutral-50 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              type="number"
              min={1}
              max={168}
              value={hours}
              onChange={(e) => setHours(Number(e.target.value) || 24)}
              disabled={running}
            />
          </label>

          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">Топ (topK)</span>
            <input
              className="mt-1 w-16 rounded border border-neutral-300 bg-neutral-50 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              type="number"
              min={1}
              max={10}
              value={topK}
              onChange={(e) => setTopK(Number(e.target.value) || 3)}
              disabled={running}
            />
          </label>

          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">LLM</span>
            <select
              className="mt-1 rounded border border-neutral-300 bg-neutral-50 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              value={llm}
              onChange={(e) => setLlm(e.target.value as Llm)}
              disabled={running}
            >
              <option value="cloud">cloud</option>
              <option value="local">local (Ollama)</option>
            </select>
          </label>

          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={enableForum}
                onChange={(e) => setEnableForum(e.target.checked)}
                disabled={running}
              />
              Forum
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={enableTelegram}
                onChange={(e) => setEnableTelegram(e.target.checked)}
                disabled={running}
              />
              TG
            </label>
          </div>

          <div className="ml-auto flex gap-2">
            <button
              className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              onClick={run}
              disabled={running}
            >
              Запустить
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
        <p className="mt-2 text-xs text-neutral-400">
         Источник TG требует настроенной MTProto-сессии — по умолчанию выключен. Запрос идёт
          в RSS/Forum + LLM-оркестратор, может занять десятки секунд.
        </p>
      </section>

      {running && (
        <p className="text-sm text-accent">Scout работает… (RSS/Forum/+TG параллельно → оркестратор)</p>
      )}

      {error && (
        <section className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </section>
      )}

      {agents.length > 0 && (
        <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Source-агенты ({agents.length})
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {agents.map((a) => (
              <li key={a.agent} className="flex items-center gap-2">
                <span className="font-mono text-xs text-accent">{a.agent}</span>
                <span className="text-neutral-500">тем: {a.count}</span>
                {a.error && <span className="text-xs text-red-600 dark:text-red-400">ошибка: {a.error}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {ranked.length > 0 && (
        <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Топ оркестратора ({ranked.length})
          </h2>
          <ol className="mt-2 space-y-2 text-sm">
            {ranked.map((t, i) => (
              <li key={i}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-neutral-400">[{i}]</span>
                  <span className="text-xs font-mono text-accent">{t.orchestratorScore}</span>
                  <span className="text-xs text-neutral-400">({t.source})</span>
                  <span className="font-medium">{t.title}</span>
                  {t.url && (
                    <a
                      href={t.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-accent hover:underline"
                    >
                      источник ↗
                    </a>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-neutral-500">{t.orchestratorReason}</p>
                {t.hypeReason && (
                  <p className="text-xs text-neutral-400">
                    накал [{t.hypeScore}]: {t.hypeReason}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {!running && ranked.length === 0 && !error && (
        <p className="text-sm text-neutral-400">
          Настройте источники и нажмите «Запустить». Оркестратор вернёт топ тем — без записи поста.
        </p>
      )}
    </div>
  );
}
