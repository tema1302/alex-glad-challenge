// /blog/news — блог-pipeline: форма (hours/top/for/llm) → SSE → пост.
// 'use client': читает SSE-стрим из /api/blog/news (start → done/error). Pipeline не имеет
// onProgress, поэтому прогресс = индикатор «работаю» от старта до done. НИКАКИХ импортов core/.
'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import type { SseBlogNewsEvent } from '../../../lib/shared/sse';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

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

const INPUT =
  'rounded border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink placeholder:text-dim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent';

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
        <h1 className="text-xl font-semibold text-ink">Блог-pipeline</h1>
        <p className="mt-1 text-sm text-dim">
          RSS → агент 1 (топ) → агент 2 (пост) → агент 3 (фактчекинг). Пост сохраняется в{' '}
          <code className="rounded bg-surface-2 px-1 text-xs text-dim">blog.sqlite</code>.
        </p>
      </section>

      <Card label="Параметры запуска">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-dim">Часов (hours)</span>
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
            <span className="block text-xs uppercase tracking-wide text-dim">Топ (top)</span>
            <input
              className={`mt-1 w-16 ${INPUT}`}
              type="number"
              min={1}
              max={50}
              value={top}
              onChange={(e) => setTop(Number(e.target.value) || 5)}
              disabled={running}
            />
          </label>

          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-dim">Пост про (index)</span>
            <input
              className={`mt-1 w-16 ${INPUT}`}
              type="number"
              min={0}
              value={forIndex}
              onChange={(e) => setForIndex(Number(e.target.value) || 0)}
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
          Pipeline мутирует blog.sqlite и ходит в RSS/LLM — запуск может занять до минуты.
        </p>
      </Card>

      {running && (
        <Card>
          <div className="flex items-center gap-2 font-mono text-xs text-dim">
            <span
              className="spin inline-block h-3 w-3 rounded-full border border-line-strong border-t-accent"
              aria-hidden
            />
            Pipeline работает… (RSS → 3 агента → пост)
          </div>
        </Card>
      )}

      {error && (
        <section className="rounded-md border border-err/40 bg-err/10 p-3 text-sm text-err">
          {error}
        </section>
      )}

      {topNews.length > 0 && (
        <Card label={`Топ-новости (${topNews.length})`}>
          <ul className="space-y-1.5 text-sm">
            {topNews.map((n, i) => (
              <li key={i}>
                <span className="text-dim">[{i}]</span>{' '}
                <span className="text-xs text-accent">{n.score}</span>{' '}
                <span className="text-ink">{n.title}</span>
                <span className="block text-xs text-dim">{n.why}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {post && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-dim">
              Пост #{post.id}
            </span>
            <Link href={`/blog/posts/${post.id}`} className="text-xs text-accent hover:underline">
              открыть →
            </Link>
          </div>
          {verdict && (
            <p className="text-xs text-dim">вердикт фактчекинга: {verdict}</p>
          )}
          <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{post.content}</p>
        </Card>
      )}

      {!running && !post && !error && topNews.length === 0 && (
        <p className="text-sm text-dim">
          Настройте параметры и нажмите «Запустить». Пост появится здесь и в{' '}
          <Link href="/blog/posts" className="text-accent hover:underline">/blog/posts</Link>.
        </p>
      )}
    </div>
  );
}
