// /antonov — студия канала «Антонов такой Антонов»: черновик любого текста
// голосом канала. Личный инструмент владельца (за auth-middleware), потребитель
// ТОГО ЖЕ серверного промпта, что и публичный Антоновайзер — POST
// /api/antonov/rewrite (см. шапку роута: те же инварианты, лимиты шире, кап 6000).
// 'use client' по канону тул-страниц (/joker): textarea + счётчик + чипы примеров
// + режим грубости + формат + подпись → 200 {ok,post} | 429/400/502/503.
// Клиентский таймаут 150с (провайдер режет генерацию на 120-й). История удачных
// генераций — localStorage (последние 10), читается в useEffect (не в рендере —
// готча гидрации). Импорты — только data/* и components/ui (без lib/server, core).
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { INPUT_CLASS } from '../components/ui/Field';
import { SectionHead } from '../components/ui/SectionHead';
import { styleCopy, styleExamples, type StyleExample } from '../../data/style';

const MAX_TEXT = 6000; // контракт antonovRewriteSchema (zod на сервере вторым слоем)
const TIMEOUT_MS = 150_000;
const HISTORY_KEY = 'antonov-history-v1';
const HISTORY_MAX = 10;

type Mode = 'soft' | 'normal' | 'hard';
type Format = 'auto' | 'post' | 'essay' | 'guide' | 'calm';
type Status = 'idle' | 'loading' | 'done' | 'error';

interface RewriteResponse {
  ok: boolean;
  post?: string;
  error?: string;
  retryAfterSec?: number;
}

interface HistoryItem {
  ts: number;
  text: string;
  post: string;
  mode: Mode;
  format: Format;
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

const CHANNEL_URL = 'https://t.me/auantonov';

function loadHistory(): HistoryItem[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (it): it is HistoryItem =>
        !!it &&
        typeof it === 'object' &&
        typeof (it as HistoryItem).ts === 'number' &&
        typeof (it as HistoryItem).text === 'string' &&
        typeof (it as HistoryItem).post === 'string',
    );
  } catch {
    return [];
  }
}

function saveHistory(items: HistoryItem[]): void {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_MAX)));
  } catch {
    // localStorage может быть недоступен (приватный режим) — история просто не пишется.
  }
}

export default function AntonovPage() {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<Mode>('normal');
  const [format, setFormat] = useState<Format>('auto');
  const [signature, setSignature] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [post, setPost] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);

  // История — только на клиенте после гидратации (localStorage-остров).
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

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
      const r = await fetch('/api/antonov/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: t, mode, format, signature }),
        signal: ac.signal,
      });
      const data = (await r.json().catch(() => null)) as RewriteResponse | null;
      if (data !== null && data.ok && typeof data.post === 'string') {
        setPost(data.post);
        setStatus('done');
        setHistory((prev) => {
          const next = [
            { ts: Date.now(), text: t, post: data.post as string, mode, format },
            ...prev.filter((it) => it.post !== data.post),
          ].slice(0, HISTORY_MAX);
          saveHistory(next);
          return next;
        });
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

  const restore = useCallback((it: HistoryItem) => {
    setText(it.text);
    setMode(it.mode);
    setFormat(it.format);
    setPost(it.post);
    setStatus('done');
    setError(null);
    setCopied(false);
  }, []);

  const dropItem = useCallback((ts: number) => {
    setHistory((prev) => {
      const next = prev.filter((it) => it.ts !== ts);
      saveHistory(next);
      return next;
    });
  }, []);

  const loading = status === 'loading';
  const disabled = loading || text.trim().length === 0 || text.trim().length > MAX_TEXT;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <SectionHead
        code="канал"
        title="Антонов такой Антонов"
        description="Черновик любого текста голосом канала: вставь исходник, выбери подачу, забирай готовый пост. Промпт тот же, что у публичного Антоновайзера."
        actions={
          <a
            href={CHANNEL_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-line-strong px-3.5 py-1.5 text-sm font-medium text-dim transition-colors duration-fast hover:border-accent-dim hover:text-ink"
          >
            Канал ↗
          </a>
        }
      />

      <Card label="исходник">
        <label htmlFor="antonov-text" className="sr-only">
          {styleCopy.textLabel}
        </label>
        <textarea
          id="antonov-text"
          className={`h-44 w-full resize-y ${INPUT_CLASS}`}
          value={text}
          maxLength={MAX_TEXT}
          onChange={(e) => setText(e.target.value)}
          placeholder={styleCopy.textPlaceholder}
          disabled={loading}
        />
        <div className="mt-1.5 text-right font-mono text-xs text-dim">
          {text.length} / {MAX_TEXT}
        </div>

        {styleExamples.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={styleCopy.examplesLabel}>
            {styleExamples.map((ex: StyleExample) => (
              <button
                key={ex.label}
                type="button"
                className="rounded-md border border-line px-2.5 py-1 text-xs text-dim transition-colors duration-fast hover:border-accent-dim hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => setText(ex.text)}
                disabled={loading}
              >
                {ex.label}
              </button>
            ))}
          </div>
        )}

        <fieldset className="mt-5" disabled={loading}>
          <legend className="font-mono text-xs uppercase tracking-wider text-dim">
            {styleCopy.modeLabel}
          </legend>
          <div className="mt-2 inline-flex rounded-md border border-line bg-surface p-1" role="radiogroup" aria-label={styleCopy.modeLabel}>
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={mode === m.id}
                className={`rounded px-3.5 py-1.5 text-sm font-medium transition-colors duration-fast ${
                  mode === m.id ? 'bg-accent text-accent-ink' : 'text-dim hover:text-ink'
                }`}
                onClick={() => setMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3">
          <div>
            <label
              htmlFor="antonov-format"
              className="block font-mono text-xs uppercase tracking-wider text-dim"
            >
              {styleCopy.formatLabel}
            </label>
            <select
              id="antonov-format"
              className={`mt-2 ${INPUT_CLASS} w-auto`}
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
          <label className="flex cursor-pointer items-center gap-2 text-sm text-dim">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={signature}
              onChange={(e) => setSignature(e.target.checked)}
              disabled={loading}
            />
            {styleCopy.signatureLabel}
          </label>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-4">
          <Button variant="primary" onClick={() => void submit()} disabled={disabled} loading={loading}>
            {loading ? styleCopy.rewriting : styleCopy.rewrite}
          </Button>
          {!loading && text.trim().length === 0 && (
            <span className="text-sm text-dim">{styleCopy.emptyHint}</span>
          )}
        </div>
      </Card>

      {/* Единая live-область результата: loading / пост / ошибка. */}
      <div ref={resultRef} role="status" aria-live="polite" tabIndex={-1} className="focus:outline-none">
        {loading && (
          <Card label="результат">
            <p className="flex items-center gap-3 text-sm text-dim">
              <span
                aria-hidden="true"
                className="spin inline-block h-3.5 w-3.5 rounded-full border-2 border-accent border-t-transparent"
              />
              {styleCopy.rewriting}
            </p>
          </Card>
        )}

        {status === 'done' && post !== null && (
          <Card
            label={styleCopy.resultTitle}
            actions={
              <Button size="sm" variant="ghost" onClick={() => void copy()}>
                {copied ? styleCopy.copied : styleCopy.copy}
              </Button>
            }
          >
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{post}</p>
          </Card>
        )}

        {status === 'error' && error !== null && (
          <Card tone="danger" label="ошибка">
            <p className="text-sm leading-relaxed text-err">{error}</p>
          </Card>
        )}
      </div>

      {history.length > 0 && (
        <Card label="история (последние 10)">
          <ul className="flex flex-col gap-2">
            {history.map((it) => (
              <li
                key={it.ts}
                className="flex items-start justify-between gap-3 rounded-lg border border-line px-3 py-2"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left transition-colors duration-fast hover:text-ink"
                  onClick={() => restore(it)}
                  title="Открыть в студии"
                >
                  <span className="block truncate text-sm text-ink">
                    {it.post.split('\n')[0] || it.text.slice(0, 80)}
                  </span>
                  <span className="mt-0.5 block font-mono text-[11px] text-dim">
                    {new Date(it.ts).toLocaleString('ru-RU')} · {it.text.length} зн. ·{' '}
                    {MODES.find((m) => m.id === it.mode)?.label ?? it.mode}
                  </span>
                </button>
                <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard.writeText(it.post)}>
                  {styleCopy.copy}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => dropItem(it.ts)} aria-label="Удалить из истории">
                  ✕
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
