// /blog/news — блог-pipeline: форма (hours/top/for/llm) → SSE → пост.
// 'use client': читает SSE-стрим из /api/blog/news (start → done/error). Pipeline не имеет
// onProgress, поэтому прогресс = индикатор «работаю» от старта до done. НИКАКИХ импортов core/.
'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import type { SseBlogNewsEvent } from '../../../lib/shared/sse';

type Llm = 'local' | 'cloud';

interface DonePost {
  id: number;
  content: string;
}
interface TopNewsItem {
  title: string;
  score: number;
  why: string;
}

export default function BlogNewsPage() {
  const [hours, setHours] = useState(24);
  const [top, setTop] = useState(5);
  const [forIndex, setForIndex] = useState(0);
  const [llm, setLlm] = useState<Llm>('cloud');

  const [running, setRunning] = useState(false);
  const [post, setPost] = useState<DonePost | null>(null);
  const [topNews, setTopNews] = useState<TopNewsItem[]>([]);
  const [verdict, setVerdict] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const reset = (): void => {
    setPost(null);
    setTopNews([]);
    setVerdict(null);
    setError(null);
  };

  const run = useCallback(async () => {
    if (running) return;
    reset();
    setRunning(true);
    const ac = new AbortController();
    abortRef.current = ac;

    const handle = (ev: SseBlogNewsEvent): void => {
      switch (ev.type) {
        case 'stage':
          // step === 'start' — индикатор «работаю» уже включён через running.
          break;
        case 'done':
          setPost(ev.post);
          setTopNews(ev.topNews);
          setVerdict(ev.verdict);
          break;
        case 'error':
          setError(ev.message);
          break;
      }
    };

    try {
      const resp = await fetch('/api/blog/news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours, top, forIndex, llm }),
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
          let ev: SseBlogNewsEvent;
          try {
            ev = JSON.parse(dataLine) as SseBlogNewsEvent;
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
  }, [hours, top, forIndex, llm, running]);

  const cancel = (): void => {
    abortRef.current?.abort();
  };

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold">Блог-pipeline</h1>
        <p className="mt-1 text-sm text-neutral-500">
          RSS → агент 1 (топ) → агент 2 (пост) → агент 3 (фактчекинг). Пост сохраняется в{' '}
          <code className="rounded bg-neutral-200 px-1 text-xs dark:bg-neutral-800">blog.sqlite</code>.
        </p>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">Часов (hours)</span>
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
            <span className="block text-xs uppercase tracking-wide text-neutral-500">Топ (top)</span>
            <input
              className="mt-1 w-16 rounded border border-neutral-300 bg-neutral-50 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              type="number"
              min={1}
              max={50}
              value={top}
              onChange={(e) => setTop(Number(e.target.value) || 5)}
              disabled={running}
            />
          </label>

          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">Пост про (index)</span>
            <input
              className="mt-1 w-16 rounded border border-neutral-300 bg-neutral-50 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              type="number"
              min={0}
              value={forIndex}
              onChange={(e) => setForIndex(Number(e.target.value) || 0)}
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
          Pipeline мутирует blog.sqlite и ходит в RSS/LLM — запуск может занять до минуты.
        </p>
      </section>

      {running && (
        <p className="text-sm text-accent">Pipeline работает… (RSS → 3 агента → пост)</p>
      )}

      {error && (
        <section className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </section>
      )}

      {topNews.length > 0 && (
        <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Топ-новости ({topNews.length})
          </h2>
          <ul className="mt-2 space-y-1.5 text-sm">
            {topNews.map((n, i) => (
              <li key={i}>
                <span className="text-neutral-400">[{i}]</span>{' '}
                <span className="text-xs text-accent">{n.score}</span>{' '}
                <span>{n.title}</span>
                <span className="block text-xs text-neutral-400">{n.why}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {post && (
        <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Пост #{post.id}</h2>
            <Link href={`/blog/posts/${post.id}`} className="text-xs text-accent hover:underline">
              открыть →
            </Link>
          </div>
          {verdict && (
            <p className="mt-1 text-xs text-neutral-400">вердикт фактчекинга: {verdict}</p>
          )}
          <p className="mt-2 whitespace-pre-wrap text-sm">{post.content}</p>
        </section>
      )}

      {!running && !post && !error && topNews.length === 0 && (
        <p className="text-sm text-neutral-400">
          Настройте параметры и нажмите «Запустить». Пост появится здесь и в{' '}
          <Link href="/blog/posts" className="text-accent hover:underline">/blog/posts</Link>.
        </p>
      )}
    </div>
  );
}
