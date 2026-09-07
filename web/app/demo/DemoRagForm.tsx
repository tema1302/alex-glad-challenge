// /demo — client-остров RAG-формы (единственный client-компонент страницы;
// паттерн jira/JiraForm, но в светлом мире лендинга .lp). textarea (≤300,
// счётчик) + чипы примеров (клик — подстановка и отправка) → POST /api/demo/rag
// по замороженному контракту §2: 200 {ok,answer,gaveUp,sources[]} |
// 400/429/502/503 {ok:false,error,retryAfterSec?}. Abort: размонтирование,
// новый запрос, клиентский таймаут 60с (сервер сам обрывает генерацию на 45-й).
// Человекочитаемые ошибки — фолбэки из data/demo.ts, сырые e.message наружу не
// выводим. Без markdown-рендера и dangerouslySetInnerHTML; импорты — только
// data/* + components (инвариант: client не тянет lib/server и @challenge).
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SubscribeButton } from '../components/landing/SubscribeButton';
import { channel } from '../../data/landing';
import {
  demoCopy,
  type DemoExample,
  type DemoRagResponse,
  type DemoRagSource,
} from '../../data/demo';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-paper';

const TEXTAREA =
  'w-full resize-y rounded-xl border border-p-line bg-paper-2 p-3 text-[15px] leading-relaxed text-p-ink placeholder:text-p-dim/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-paper';

const MAX_QUESTION = 300; // контракт §2
const TIMEOUT_MS = 60_000;

type Status = 'idle' | 'loading' | 'done' | 'error';

interface DoneState {
  answer: string;
  gaveUp: boolean;
  sources: DemoRagSource[];
}

export function DemoRagForm({ examples }: { examples: readonly DemoExample[] }) {
  const [question, setQuestion] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [done, setDone] = useState<DoneState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);

  // Размонтирование — снять висящий запрос.
  useEffect(() => () => abortRef.current?.abort(), []);

  const submit = useCallback(async (raw: string) => {
    const q = raw.trim();
    if (q.length === 0 || q.length > MAX_QUESTION) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);

    setStatus('loading');
    setError(null);
    setDone(null);
    try {
      const r = await fetch('/api/demo/rag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
        signal: ac.signal,
      });
      const data = (await r.json().catch(() => null)) as DemoRagResponse | null;
      if (data !== null && data.ok) {
        setDone({ answer: data.answer, gaveUp: data.gaveUp, sources: data.sources });
        setStatus('done');
        // Фокус в результат: скринридер и клавиатура сразу в ответе.
        requestAnimationFrame(() => resultRef.current?.focus());
      } else {
        const base = data ? data.error : r.status === 502 ? demoCopy.errorBaseUnavailable : `Ошибка ${r.status}`;
        const retryMin =
          data && !data.ok && typeof data.retryAfterSec === 'number'
            ? Math.max(1, Math.ceil(data.retryAfterSec / 60))
            : null;
        setStatus('error');
        setError(
          retryMin !== null && !base.includes('мин') ? `${base} Повторите через ~${retryMin} мин.` : base,
        );
      }
    } catch (e) {
      setStatus('error');
      setError(
        e instanceof DOMException && e.name === 'AbortError'
          ? demoCopy.errorTimeout
          : demoCopy.errorNetwork,
      );
    } finally {
      clearTimeout(timer);
      if (abortRef.current === ac) abortRef.current = null;
    }
  }, []);

  const loading = status === 'loading';
  const askDisabled = loading || question.trim().length === 0 || question.trim().length > MAX_QUESTION;

  return (
    <div className="lp-card relative overflow-hidden p-5 md:p-8">
      <div className="lp-blob lp-blob-indigo -right-10 -top-10 h-40 w-40" aria-hidden="true" />

      <div className="relative">
        <label
          htmlFor="demo-question"
          className="block font-mono text-xs uppercase tracking-[0.18em] text-p-dim"
        >
          {demoCopy.questionLabel}
        </label>
        <textarea
          id="demo-question"
          className={`mt-3 h-28 ${TEXTAREA}`}
          value={question}
          maxLength={MAX_QUESTION}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={demoCopy.questionPlaceholder}
          disabled={loading}
        />
        <div className="mt-2 text-right font-mono text-xs text-p-dim">
          {question.length} / {MAX_QUESTION}
        </div>

        {/* Чипы примеров: клик — подставить вопрос и сразу отправить. */}
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Примеры вопросов">
          {examples.map((ex) => (
            <button
              key={ex.question}
              type="button"
              className={`lp-chip transition-colors duration-fast hover:border-brand-300 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`}
              onClick={() => {
                setQuestion(ex.question);
                void submit(ex.question);
              }}
              disabled={loading}
            >
              <span>{ex.question}</span>
              {ex.hint && <span className="text-p-dim/70">· {ex.hint}</span>}
            </button>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-4">
          <button
            type="button"
            className={`inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-brand-600 px-7 text-base font-bold text-white shadow-lift transition-all duration-base ease-system hover:-translate-y-0.5 hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 ${FOCUS}`}
            onClick={() => void submit(question)}
            disabled={askDisabled}
          >
            {loading && (
              <span
                aria-hidden="true"
                className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
              />
            )}
            {loading ? demoCopy.asking : demoCopy.ask}
          </button>
          {!loading && question.trim().length === 0 && (
            <span className="text-sm text-p-dim">{demoCopy.emptyHint}</span>
          )}
        </div>

        {/* Единая live-область результата: loading / ответ / «не знаю» / ошибка. */}
        <div
          ref={resultRef}
          role="status"
          aria-live="polite"
          tabIndex={-1}
          className="mt-6 focus:outline-none"
        >
          {loading && (
            <p className="flex items-center gap-3 text-sm text-p-dim">
              <span
                aria-hidden="true"
                className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-brand-300 border-t-brand-600"
              />
              {demoCopy.asking}
            </p>
          )}

          {status === 'done' && done && done.gaveUp && (
            <section className="rounded-xl border border-brand-200 bg-brand-50/60 p-4 md:p-5">
              <h3 className="font-display text-lg font-semibold text-p-ink">{demoCopy.notKnowTitle}</h3>
              <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-p-ink md:text-base">
                {done.answer}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-p-dim">{demoCopy.notKnowNote}</p>
            </section>
          )}

          {status === 'done' && done && !done.gaveUp && (
            <>
              <section aria-label={demoCopy.answerTitle}>
                <h3 className="font-display text-lg font-semibold text-p-ink">{demoCopy.answerTitle}</h3>
                {/* Крупный текст ответа; отсылки [1]..[n] — как есть, без markdown. */}
                <p className="mt-2 whitespace-pre-wrap text-lg leading-relaxed text-p-ink">
                  {done.answer}
                </p>
              </section>

              {done.sources.length > 0 && (
                <section aria-label={demoCopy.sourcesTitle} className="mt-6">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <h3 className="font-display text-lg font-semibold text-p-ink">
                      {demoCopy.sourcesTitle}
                    </h3>
                    <span className="font-mono text-[11px] uppercase tracking-wider text-p-dim/70">
                      {demoCopy.sourcesHint}
                    </span>
                  </div>
                  <ol className="mt-3 space-y-3">
                    {done.sources.map((s) => (
                      <li key={s.n} className="rounded-xl border border-p-line bg-paper-2 p-4">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span className="font-mono text-sm font-semibold text-brand-600">[{s.n}]</span>
                          <span className="font-medium text-p-ink">{s.title}</span>
                          {s.section && s.section !== s.title && (
                            <span className="font-mono text-xs text-p-dim">· {s.section}</span>
                          )}
                          <span className="ml-auto font-mono text-xs text-p-dim/70">
                            score {s.score.toFixed(3)}
                          </span>
                        </div>
                        <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-p-dim">{s.snippet}</p>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              <div className="mt-6 border-t border-p-line pt-4">
                <SubscribeButton href={channel.url} label={channel.subscribeLabel} variant="inline" />
              </div>
            </>
          )}

          {status === 'error' && error !== null && (
            <p className="rounded-xl border border-err/40 bg-err/10 p-4 text-sm leading-relaxed text-err">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
