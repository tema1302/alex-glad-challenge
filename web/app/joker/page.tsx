// /joker — «Кино-Шутник»: multi-turn чат с локальной LLM (Ollama qwen3.5). Slug joke-chat.
// 'use client': load single joker-сессии (GET) + SSE-стрим реплики (POST) + reset (PATCH).
// Шаблон: клон чат-паттернов chat/[sessionId]/page.tsx (textarea+Enter-to-send, SSE-ридер,
// autoscroll, AbortController). Без импортов core/ — только lib/shared/* + components/ui/*.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SseEvent, SseUsage } from '../../lib/shared/sse';
import { Button } from '../components/ui/Button';
import { SectionLabel } from '../components/ui/SectionLabel';
import { StatusDot } from '../components/ui/StatusDot';

type Role = 'user' | 'assistant' | 'system';

interface SessionMessage {
  role: Role;
  content: string;
  ts: string;
}

const INPUT =
  'rounded border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink placeholder:text-dim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent';

const TEMP_MIN = 0.3;
const TEMP_MAX = 1.2;
const TEMP_STEP = 0.05;
const TEMP_DEFAULT = 0.9;

// Должно совпадать с серверным TIMEOUT_MS (app/api/joke/session/route.ts). Только для
// текста хинта при timeout-abort.
const JOKER_TIMEOUT_SEC = 180;

type JokerErrorHint =
  | { kind: 'cancelled' }
  | { kind: 'timeout' }
  | { kind: 'refused' }
  | { kind: 'other' };

// Дискриминация по тексту ошибки для точного хинта (4 ветки). Не плодим абстракции:
// подстрока message. user-cancel = 'Отменено' (клиентский catch); серверный AbortError =
// '...aborted'; connection-refused = 'fetch failed'/'Failed to fetch'/'ECONNREFUSED'/'network error'.
function classifyJokerError(msg: string): JokerErrorHint {
  if (msg === 'Отменено') return { kind: 'cancelled' };
  const lower = msg.toLowerCase();
  if (lower.includes('aborted')) return { kind: 'timeout' };
  if (
    lower.includes('fetch failed') ||
    lower.includes('failed to fetch') ||
    lower.includes('econnrefused') ||
    lower.includes('network error')
  ) {
    return { kind: 'refused' };
  }
  return { kind: 'other' };
}

// «Умный контекст»: первая строка assistant-реплики «🎬 Фильм (год) — сцена» (обязана промптом)
// → badge font-mono text-dim; остаток — тело шутки. Пока первая строка стримится (без \n),
// badge не показываем. Если модель не выдала 🎬 — весь текст телом (graceful). React text-render,
// БЕЗ dangerouslySetInnerHTML.
function parseBadge(content: string, streaming: boolean): { badge: string | null; body: string } {
  if (!content.startsWith('🎬')) return { badge: null, body: content };
  const nl = content.indexOf('\n');
  if (nl < 0) {
    // Первая строка ещё не закрыта переносом.
    if (streaming) return { badge: null, body: '' };
    return { badge: null, body: content };
  }
  return { badge: content.slice(0, nl).trim(), body: content.slice(nl + 1) };
}

export default function JokerPage() {
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [usage, setUsage] = useState<SseUsage | null>(null);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [temperature, setTemperature] = useState(TEMP_DEFAULT);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // --- load single joker-session on mount ---
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    fetch('/api/joke/session')
      .then(async (r) => {
        if (!r.ok) { setLoadError(`HTTP ${r.status}`); return null; }
        return r.json() as Promise<{ session: { messages: SessionMessage[]; usage: SseUsage } }>;
      })
      .then((data) => {
        if (cancelled || !data) return;
        setMessages(data.session.messages.filter((m) => m.role !== 'system'));
        setUsage(data.session.usage);
      })
      .catch(() => { if (!cancelled) setLoadError('network error'); });
    return () => { cancelled = true; };
  }, []);

  // --- autoscroll ---
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // --- фокус в инпут на mount; оборвать стрим при размонтировании ---
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(async (): Promise<void> => {
    const text = input.trim();
    if (!text || running) return;
    setError(null);
    setRunning(true);
    setInput('');

    const userMsg: SessionMessage = { role: 'user', content: text, ts: new Date().toISOString() };
    const assistantMsg: SessionMessage = { role: 'assistant', content: '', ts: new Date().toISOString() };
    setMessages((p) => [...p, userMsg, assistantMsg]);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const resp = await fetch('/api/joke/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, temperature }),
        signal: ac.signal,
      });
      if (!resp.ok || !resp.body) {
        const txt = await resp.text().catch(() => '');
        let msg = `HTTP ${resp.status}`;
        try { const j = JSON.parse(txt) as { error?: string }; if (j.error) msg = j.error; }
        catch { if (txt) msg = txt.slice(0, 200); }
        setError(msg);
        setMessages((p) => p.slice(0, -1));
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
          try { ev = JSON.parse(dataLine) as SseEvent; }
          catch { continue; }
          if (ev.type === 'token') {
            setMessages((p) => {
              const next = p.slice();
              next[next.length - 1] = { ...next[next.length - 1], content: next[next.length - 1].content + ev.delta };
              return next;
            });
          } else if (ev.type === 'done') {
            if (typeof ev.answer === 'string') {
              setMessages((p) => {
                const next = p.slice();
                next[next.length - 1] = { ...next[next.length - 1], content: ev.answer as string };
                return next;
              });
            }
            if (ev.usage) setUsage(ev.usage);
          } else if (ev.type === 'error') {
            setError(ev.message);
            setMessages((p) => p.slice(0, -1));
          }
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        // Частичная реплика при отмене остаётся (как в /chat).
        setError('Отменено');
      } else {
        setError(e instanceof Error ? e.message : 'request failed');
        setMessages((p) => p.slice(0, -1));
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [input, running, temperature]);

  const cancel = (): void => { abortRef.current?.abort(); };

  const onReset = async (): Promise<void> => {
    if (running) return;
    try {
      const resp = await fetch('/api/joke/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset: true }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      setMessages([]);
      setUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'reset failed');
    }
  };

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <p className="text-sm text-err">Сессия не загружена: {loadError}</p>
      </div>
    );
  }

  const errorHint = error ? classifyJokerError(error) : null;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* Хедер */}
      <section className="flex items-start justify-between gap-4">
        <div>
          <SectionLabel>agent</SectionLabel>
          <h1 className="font-mono text-2xl font-semibold uppercase tracking-tight text-ink">Кино-Шутник</h1>
          <p className="mt-1 text-sm text-dim">
            Локальная LLM обыгрывает культовые сцены. Стрим + контекст сцены. Переживает reload.
          </p>
        </div>
        <StatusDot status="ok" label="local · qwen3.5" />
      </section>

      {/* Параметры (свёрнуты): слайдер температуры */}
      <details className="rounded-md border border-line bg-surface">
        <summary className="cursor-pointer select-none px-3 py-2 font-mono text-xs uppercase tracking-wider text-dim hover:text-ink">
          параметры
        </summary>
        <div className="border-t border-line px-3 py-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xs uppercase tracking-wide text-dim">Температура</span>
            <span className="font-mono text-xs text-ink tabular-nums">{temperature.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={TEMP_MIN}
            max={TEMP_MAX}
            step={TEMP_STEP}
            value={temperature}
            onChange={(e) => setTemperature(Number(e.target.value))}
            disabled={running}
            className="mt-2 w-full accent-accent"
            aria-label="Температура генерации"
          />
          <div className="mt-0.5 flex justify-between font-mono text-[10px] text-dim">
            <span>стабильно</span>
            <span>разнузданно</span>
          </div>
        </div>
      </details>

      {/* Тулбар: usage + очистить */}
      <div className="flex items-center justify-end gap-3">
        {usage && (
          <span className="font-mono text-xs text-dim tabular-nums">
            Σ {usage.total_tokens} (↑{usage.prompt_tokens}/↓{usage.completion_tokens})
          </span>
        )}
        <button
          type="button"
          className="rounded border border-line-strong px-2 py-1 text-xs text-dim transition-colors hover:text-ink disabled:opacity-50"
          onClick={() => void onReset()}
          disabled={running}
        >
          Очистить
        </button>
      </div>

      {/* История */}
      <section
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-atomic="false"
        className="h-[50vh] space-y-3 overflow-y-auto rounded-md border border-line bg-bg p-4"
      >
        {messages.length === 0 && (
          <p className="text-sm text-dim">
            Я — Кино-Шутник. Напиши реплику — обыграю её культовой киносценой.
          </p>
        )}
        {messages.map((m, i) => {
          const isLast = i === messages.length - 1;
          const streaming = isLast && running && m.role === 'assistant';
          const { badge, body } = parseBadge(m.content, streaming);
          return (
            <div key={i} className={`rounded-md p-3 text-sm ${m.role === 'user' ? 'bg-surface-2' : 'bg-surface'}`}>
              <div className="mb-1 font-mono text-xs uppercase tracking-wider text-dim">
                {m.role === 'user' ? 'ВЫ' : 'CINE-PUN'}
              </div>
              {badge && <div className="mb-1 font-mono text-xs text-dim">{badge}</div>}
              <div className="whitespace-pre-wrap break-words text-ink">
                {body}
                {streaming && <span className="text-accent animate-pulse" aria-hidden="true">▍</span>}
              </div>
            </div>
          );
        })}
      </section>

      {error && (
        <p className="rounded border border-err/40 bg-err/10 p-2 text-sm text-err">
          {error}
          {errorHint?.kind === 'refused' && (
            <span className="mt-1 block text-dim">
              Ollama не отвечает? Запустите <code className="font-mono text-err">ollama serve</code> на 127.0.0.1:11434 и повторите.
            </span>
          )}
          {errorHint?.kind === 'timeout' && (
            <span className="mt-1 block text-dim">
              Превысили время ожидания ({JOKER_TIMEOUT_SEC}с). Ollama долго отвечает — попробуйте ещё раз.
            </span>
          )}
        </p>
      )}

      {/* Ввод */}
      <form
        className="flex gap-2"
        onSubmit={(e) => { e.preventDefault(); void send(); }}
      >
        <textarea
          ref={inputRef}
          className={`flex-1 resize-none ${INPUT}`}
          rows={2}
          placeholder="Сообщение… (Enter — отправить, Shift+Enter — перенос)"
          aria-label="Сообщение кино-шутнику"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
          }}
          disabled={running}
        />
        <div className="flex flex-col gap-1">
          <Button variant="primary" type="submit" disabled={running || !input.trim()}>
            {running ? '…' : 'Отправить'}
          </Button>
          <Button variant="ghost" type="button" onClick={cancel} disabled={!running}>
            Стоп
          </Button>
        </div>
      </form>
    </div>
  );
}
