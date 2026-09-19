// /style — client-остров «Антоновайзера» (единственный client-компонент
// страницы; паттерн DemoRagForm, светлый мир .lp). textarea (≤2000, счётчик) +
// режим грубости (3 сегмента) + формат (select) + подпись (checkbox) +
// чипы примеров → POST /api/style/rewrite по контракту:
// 200 {ok,post} | 400/429/502/503 {ok:false,error,retryAfterSec?}.
// Abort: размонтирование, новый запрос, клиентский таймаут 150с (LLM-провайдер
// сам режет генерацию на 120-й). Результат — plain text + кнопка «Скопировать».
// Импорты — только data/* (инвариант: client не тянет lib/server и @challenge).
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  styleCopy,
  type StyleExample,
} from '../../data/style';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-paper';

const TEXTAREA =
  'w-full resize-y rounded-xl border border-p-line bg-paper-2 p-3 text-[15px] leading-relaxed text-p-ink placeholder:text-p-dim/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-paper';

const MAX_TEXT = 2000; // контракт формы (zod на сервере вторым слоем)
const TIMEOUT_MS = 150_000;

type Mode = 'soft' | 'normal' | 'hard';
type Format = 'auto' | 'post' | 'essay' | 'guide' | 'calm';
type Status = 'idle' | 'loading' | 'done' | 'error';

interface RewriteResponse {
  ok: boolean;
  post?: string;
  error?: string;
  retryAfterSec?: number;
}

const MODES: ReadonlyArray<{ id: Mode; label: string }> = [
  { id: 'soft', label: styleCopy.modeSoft },
  { id: 'normal', label: styleCopy.modeNormal },
  { id: 'hard', label: styleCopy.modeHard },
];

const FORMATS: ReadonlyArray<{ id: Format; label: string }> = [
  { id: 'auto', label: styleCopy.formatAuto },
  { id: 'post', label: styleCopy.formatPost },
  { id: 'essay', label: styleCopy.formatEssay },
  { id: 'guide', label: styleCopy.formatGuide },
  { id: 'calm', label: styleCopy.formatCalm },
];

export function StyleForm({ examples }: { examples?: readonly StyleExample[] }) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<Mode>('normal');
  const [format, setFormat] = useState<Format>('auto');
  const [signature, setSignature] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [post, setPost] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);

  // Размонтирование — снять висящий запрос.
  useEffect(() => () => abortRef.current?.abort(), []);

  const submit = useCallback(async () => {
    const t = text.trim();
    if (t.length === 0 || t.length > MAX_TEXT) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);

    setStatus('loading');
    setPost(null);
    setError(null);
    setCopied(false);
    try {
      const r = await fetch('/api/style/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: t, mode, format, signature }),
        signal: ac.signal,
      });
      const data = (await r.json().catch(() => null)) as RewriteResponse | null;
      if (data !== null && data.ok && typeof data.post === 'string') {
        setPost(data.post);
        setStatus('done');
        requestAnimationFrame(() => resultRef.current?.focus());
      } else {
        let base: string;
        if (data?.error != null) base = data.error;
        else if (r.status === 502) base = styleCopy.errorBaseUnavailable;
        else base = `Ошибка ${r.status}`;
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
          ? styleCopy.errorTimeout
          : styleCopy.errorNetwork,
      );
    } finally {
      clearTimeout(timer);
      if (abortRef.current === ac) abortRef.current = null;
    }
  }, [text, mode, format, signature]);

  const copy = useCallback(async () => {
    if (post === null) return;
    try {
      await navigator.clipboard.writeText(post);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API может быть запрещён (http, разрешения) — молча остаёмся.
    }
  }, [post]);

  const loading = status === 'loading';
  const disabled = loading || text.trim().length === 0 || text.trim().length > MAX_TEXT;

  return (
    <div className="lp-card relative overflow-hidden p-5 md:p-8">
      <div className="lp-blob lp-blob-indigo -right-10 -top-10 h-40 w-40" aria-hidden="true" />

      <div className="relative">
        <label
          htmlFor="style-text"
          className="block font-mono text-xs uppercase tracking-[0.18em] text-p-dim"
        >
          {styleCopy.textLabel}
        </label>
        <textarea
          id="style-text"
          className={`mt-3 h-36 ${TEXTAREA}`}
          value={text}
          maxLength={MAX_TEXT}
          onChange={(e) => setText(e.target.value)}
          placeholder={styleCopy.textPlaceholder}
          disabled={loading}
        />
        <div className="mt-2 text-right font-mono text-xs text-p-dim">
          {text.length} / {MAX_TEXT}
        </div>

        {/* Чипы примеров: клик — подставить исходник (без автосообщения). */}
        {examples && examples.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={styleCopy.examplesLabel}>
            {examples.map((ex) => (
              <button
                key={ex.label}
                type="button"
                className={`lp-chip transition-colors duration-fast hover:border-brand-300 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`}
                onClick={() => setText(ex.text)}
                disabled={loading}
              >
                <span>{ex.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* Режим грубости: сегмент из трёх кнопок (radio-семантика). */}
        <fieldset className="mt-5" disabled={loading}>
          <legend className="block font-mono text-xs uppercase tracking-[0.18em] text-p-dim">
            {styleCopy.modeLabel}
          </legend>
          <div className="mt-2 inline-flex rounded-full border border-p-line bg-paper-2 p-1" role="radiogroup" aria-label={styleCopy.modeLabel}>
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={mode === m.id}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors duration-fast ${FOCUS} ${
                  mode === m.id
                    ? 'bg-brand-600 text-white shadow-lift'
                    : 'text-p-dim hover:text-brand-600'
                }`}
                onClick={() => setMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </fieldset>

        {/* Формат + подпись: одна строка на десктопе. */}
        <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3">
          <div>
            <label
              htmlFor="style-format"
              className="block font-mono text-xs uppercase tracking-[0.18em] text-p-dim"
            >
              {styleCopy.formatLabel}
            </label>
            <select
              id="style-format"
              className={`mt-2 rounded-xl border border-p-line bg-paper-2 px-3 py-2 text-sm text-p-ink ${FOCUS}`}
              value={format}
              onChange={(e) => setFormat(e.target.value as Format)}
              disabled={loading}
            >
              {FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-p-dim">
            <input
              type="checkbox"
              className={`h-4 w-4 accent-brand-600 ${FOCUS.replace('ring-offset-paper', 'ring-offset-paper')}`}
              checked={signature}
              onChange={(e) => setSignature(e.target.checked)}
              disabled={loading}
            />
            {styleCopy.signatureLabel}
          </label>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-4">
          <button
            type="button"
            className={`inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-brand-600 px-7 text-base font-bold text-white shadow-lift transition-all duration-base ease-system hover:-translate-y-0.5 hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 ${FOCUS}`}
            onClick={() => void submit()}
            disabled={disabled}
          >
            {loading && (
              <span
                aria-hidden="true"
                className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
              />
            )}
            {loading ? styleCopy.rewriting : styleCopy.rewrite}
          </button>
          {!loading && text.trim().length === 0 && (
            <span className="text-sm text-p-dim">{styleCopy.emptyHint}</span>
          )}
        </div>

        {/* Единая live-область результата: loading / пост / ошибка. */}
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
              {styleCopy.rewriting}
            </p>
          )}

          {status === 'done' && post !== null && (
            <section aria-label={styleCopy.resultTitle} className="rounded-xl border border-p-line bg-paper-2 p-4 md:p-5">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <h3 className="font-display text-lg font-semibold text-p-ink">{styleCopy.resultTitle}</h3>
                <button
                  type="button"
                  className={`lp-chip transition-colors duration-fast hover:border-brand-300 hover:text-brand-600 ${FOCUS}`}
                  onClick={() => void copy()}
                >
                  {copied ? styleCopy.copied : styleCopy.copy}
                </button>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-p-ink md:text-base">
                {post}
              </p>
            </section>
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
