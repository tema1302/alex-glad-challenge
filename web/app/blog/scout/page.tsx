// /blog/scout — 3 source-агента (RSS/Forum/TG) → оркестратор (день 28, web P4b).
// 'use client': форма (query/hours/topK/Forum/TG/llm) → SSE (start → done/error).
// runSourceAgents без onProgress → прогресс = индикатор «работаю». В done — финальный топ
// оркестратора + сводка по агентам. НИКАКИХ импортов core/.
'use client';

import { useCallback, useRef, useState } from 'react';
import type { SseBlogScoutEvent } from '../../../lib/shared/sse';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

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

const INPUT =
  'rounded border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink placeholder:text-dim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent';

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
        <h1 className="text-xl font-semibold text-ink">Scout (3 source-агента)</h1>
        <p className="mt-1 text-sm text-dim">
          RSS + Forum (+ TG по выбору) собирают темы параллельно, оркестратор (LLM) выбирает
          финальный топ. Это этап&nbsp;1 пайплайна — без написания поста.
        </p>
      </section>

      <Card label="Параметры сбора">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex-1 min-w-[200px] text-sm">
            <span className="block text-xs uppercase tracking-wide text-dim">Запрос</span>
            <input
              className={`mt-1 w-full ${INPUT}`}
              type="text"
              placeholder="самые горячие футбольные новости"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={running}
            />
          </label>

          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-dim">Часов</span>
            <input
              className={`mt-1 w-20 ${INPUT}`}
              type="number"
              min={1}
              max={168}
              value={hours}
              onChange={(e) => setHours(Number(e.target.value) || 24)}
              disabled={running}
            />
          </label>

          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-dim">Топ (topK)</span>
            <input
              className={`mt-1 w-16 ${INPUT}`}
              type="number"
              min={1}
              max={10}
              value={topK}
              onChange={(e) => setTopK(Number(e.target.value) || 3)}
              disabled={running}
            />
          </label>

          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-dim">LLM</span>
            <select
              className={`mt-1 ${INPUT}`}
              value={llm}
              onChange={(e) => setLlm(e.target.value as Llm)}
              disabled={running}
            >
              <option value="cloud">cloud</option>
              <option value="local">local (Ollama)</option>
            </select>
          </label>

          <div className="flex items-center gap-4 text-sm text-ink">
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
            <Button variant="primary" onClick={run} disabled={running}>
              Запустить
            </Button>
            <Button variant="ghost" onClick={cancel} disabled={!running}>
              Отмена
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-dim">
          Источник TG требует настроенной MTProto-сессии — по умолчанию выключен. Запрос идёт
          в RSS/Forum + LLM-оркестратор, может занять десятки секунд.
        </p>
      </Card>

      {running && (
        <Card>
          <div className="flex items-center gap-2 font-mono text-xs text-dim">
            <span
              className="spin inline-block h-3 w-3 rounded-full border border-line-strong border-t-accent"
              aria-hidden
            />
            Scout работает… (RSS/Forum/+TG параллельно → оркестратор)
          </div>
        </Card>
      )}

      {error && (
        <section className="rounded-md border border-err/40 bg-err/10 p-3 text-sm text-err">
          {error}
        </section>
      )}

      {agents.length > 0 && (
        <Card label={`Source-агенты (${agents.length})`}>
          <ul className="space-y-1 text-sm">
            {agents.map((a) => (
              <li key={a.agent} className="flex items-center gap-2">
                <span className="font-mono text-xs text-accent">{a.agent}</span>
                <span className="text-dim">тем: {a.count}</span>
                {a.error && <span className="text-xs text-err">ошибка: {a.error}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {ranked.length > 0 && (
        <Card label={`Топ оркестратора (${ranked.length})`}>
          <ol className="space-y-2 text-sm">
            {ranked.map((t, i) => (
              <li key={i}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-dim">[{i}]</span>
                  <span className="text-xs font-mono text-accent">{t.orchestratorScore}</span>
                  <span className="text-xs text-dim">({t.source})</span>
                  <span className="font-medium text-ink">{t.title}</span>
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
                <p className="mt-0.5 text-xs text-dim">{t.orchestratorReason}</p>
                {t.hypeReason && (
                  <p className="text-xs text-dim">
                    накал [{t.hypeScore}]: {t.hypeReason}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </Card>
      )}

      {!running && ranked.length === 0 && !error && (
        <p className="text-sm text-dim">
          Настройте источники и нажмите «Запустить». Оркестратор вернёт топ тем — без записи поста.
        </p>
      )}
    </div>
  );
}
