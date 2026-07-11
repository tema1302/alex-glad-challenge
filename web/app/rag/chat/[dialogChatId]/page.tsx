// /rag/chat/[dialogChatId] — RAG-чат: стрим ответа + история + источники + task state.
// 'use client': load чата (GET) + SSE-стрим (POST) + PATCH (/task /task-clear rename).
// Сессия переживает reload: история и task_state в dialog.sqlite (server flush).
// Команды /task <desc> и /task-clear парсятся из ввода клиентом → PATCH (не через RAG-стрим).
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { SseEvent, SseSource, SseQuote, SseDebug, RagStageStep } from '../../../../lib/shared/sse';
import { useModelPrefDefault } from '../../../../lib/shared/use-model-pref';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';

type Strategy = 'fixed' | 'structure' | 'telegram';
type Llm = 'local' | 'cloud';

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  ts: string;
}

const STRATEGY_OPTIONS: Array<{ value: Strategy; label: string }> = [
  { value: 'fixed', label: 'fixed (документация)' },
  { value: 'structure', label: 'structure' },
  { value: 'telegram', label: 'telegram (по chat/topic)' },
];

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

export default function RagChatSessionPage() {
  const params = useParams<{ dialogChatId: string }>();
  const dialogChatId = params.dialogChatId;

  const [title, setTitle] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [taskStateText, setTaskStateText] = useState('');
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [strategy, setStrategy] = useState<Strategy>('fixed');
  const [llm, setLlm] = useState<Llm>('local');
  // follow-up P5: дефолт llm-селектора — из preference (cookie model_pref через /api/settings).
  useModelPrefDefault(setLlm);
  const [k, setK] = useState(4);
  const [chatKey, setChatKey] = useState('');
  const [topicId, setTopicId] = useState('');
  // P3b: /norag — ответ без RAG (chatStream напрямую). Переключается командой /norag.
  const [noRag, setNoRag] = useState(false);

  // Источники/цитаты/debug ПОСЛЕДНЕГО хода (как /rag single-shot).
  const [sources, setSources] = useState<SseSource[]>([]);
  const [quotes, setQuotes] = useState<SseQuote[]>([]);
  const [debug, setDebug] = useState<SseDebug | null>(null);
  const [stages, setStages] = useState<Array<{ step: RagStageStep; detail?: unknown }>>([]);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // --- load on mount / id change ---
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setMessages([]);
    setTaskStateText('');
    fetch(`/api/rag/chat/${dialogChatId}`)
      .then(async (r) => {
        if (!r.ok) { setLoadError(`HTTP ${r.status}`); return null; }
        return r.json() as Promise<{
          chat: { title: string };
          messages: ChatMessage[];
          taskStateText: string;
        }>;
      })
      .then((data) => {
        if (cancelled || !data) return;
        setTitle(data.chat.title);
        setMessages(data.messages);
        setTaskStateText(data.taskStateText);
      })
      .catch(() => { if (!cancelled) setLoadError('network error'); });
    return () => { cancelled = true; };
  }, [dialogChatId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const patch = useCallback(async (body: { title?: string; task?: string; taskClear?: boolean }): Promise<{ taskStateText?: string } | null> => {
    const resp = await fetch(`/api/rag/chat/${dialogChatId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return (await resp.json()) as { taskStateText?: string };
  }, [dialogChatId]);

  const send = useCallback(async (): Promise<void> => {
    const raw = input.trim();
    if (!raw || running) return;
    setError(null);

    // --- /-команды: /task <desc>, /task-clear → PATCH, минуя RAG-стрим ---
    if (raw === '/task-clear') {
      setInput('');
      try {
        const r = await patch({ taskClear: true });
        setTaskStateText(r?.taskStateText ?? '');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'task-clear failed');
      }
      return;
    }
    if (raw.startsWith('/task ')) {
      const goal = raw.slice('/task '.length).trim();
      if (!goal) { setError('/task: укажите цель'); return; }
      setInput('');
      try {
        const r = await patch({ task: goal });
        setTaskStateText(r?.taskStateText ?? '');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'task failed');
      }
      return;
    }
    // /norag — переключатель режима «без RAG» (chatStream напрямую, без поиска по базе).
    if (raw === '/norag') {
      setInput('');
      setNoRag((v) => !v);
      return;
    }

    setRunning(true);
    setInput('');
    setSources([]); setQuotes([]); setDebug(null); setStages([]);

    const userMsg: ChatMessage = { id: -1, role: 'user', content: raw, ts: new Date().toISOString() };
    const assistantMsg: ChatMessage = { id: -2, role: 'assistant', content: '', ts: new Date().toISOString() };
    setMessages((p) => [...p, userMsg, assistantMsg]);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const resp = await fetch(`/api/rag/chat/${dialogChatId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: raw, strategy, llm, k, noRag,
          chatKey: strategy === 'telegram' ? chatKey || undefined : undefined,
          topicId: strategy === 'telegram' && topicId ? Number(topicId) : undefined,
        }),
        signal: ac.signal,
      });
      if (!resp.ok || !resp.body) {
        const txt = await resp.text().catch(() => '');
        setError(`HTTP ${resp.status}: ${txt.slice(0, 200)}`);
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
          const line = buf.slice(0, sep).trim();
          buf = buf.slice(sep + 2);
          if (!line.startsWith('data:')) continue;
          const dataLine = line.slice(5).trim();
          if (!dataLine) continue;
          let ev: SseEvent;
          try { ev = JSON.parse(dataLine) as SseEvent; } catch { continue; }
          if (ev.type === 'stage') {
            setStages((p) => [...p, { step: ev.step, detail: ev.detail }]);
          } else if (ev.type === 'token') {
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
            setSources(ev.sources ?? []);
            setQuotes(ev.quotes ?? []);
            setDebug(ev.debug ?? null);
          } else if (ev.type === 'error') {
            setError(ev.message);
            setMessages((p) => p.slice(0, -1));
          }
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setError('Отменено');
      } else {
        setError(e instanceof Error ? e.message : 'request failed');
        setMessages((p) => p.slice(0, -1));
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
      // Перезабрать историю с серверными id/ts (flush дал настоящие id) — безопасно для персистента.
      void reloadHistory();
    }
  }, [input, running, dialogChatId, strategy, llm, k, chatKey, topicId, noRag]);

  const reloadHistory = useCallback(async (): Promise<void> => {
    try {
      const r = await fetch(`/api/rag/chat/${dialogChatId}`);
      if (!r.ok) return;
      const data = (await r.json()) as { messages: ChatMessage[]; taskStateText: string };
      setMessages(data.messages);
      setTaskStateText(data.taskStateText);
    } catch {
      // best-effort: серверный flush уже прошёл; локальное состояние корректно.
    }
  }, [dialogChatId]);

  const cancel = (): void => { abortRef.current?.abort(); };

  const onRename = async (): Promise<void> => {
    const t = prompt('Заголовок чата:', title);
    if (t === null) return;
    try {
      await patch({ title: t || 'untitled' });
      setTitle(t || 'untitled');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'rename failed');
    }
  };

  if (loadError) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-err">Чат не загружен: {loadError}</p>
        <Link href="/rag/chat" className="text-sm text-accent hover:underline">← к списку чатов</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">{title || 'RAG-чат'}</h1>
          <p className="mt-1 font-mono text-xs text-dim">{dialogChatId}</p>
        </div>
        <Link href="/rag/chat" className="text-sm text-accent hover:underline">чаты</Link>
      </section>

      {/* Панель управления */}
      <Card label="Параметры">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-dim">Стратегия</span>
            <select
              className={`mt-1 ${INPUT}`}
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as Strategy)}
              disabled={running}
            >
              {STRATEGY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
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
              type="number" min={1} max={20}
              value={k}
              onChange={(e) => setK(Number(e.target.value) || 4)}
              disabled={running}
            />
          </label>
          <button
            className="ml-auto rounded border border-line-strong px-2 py-1 text-xs text-dim transition-colors hover:text-ink disabled:opacity-50"
            onClick={onRename}
            disabled={running}
          >
            переименовать
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span
            className={
              'rounded-full border px-2 py-0.5 ' +
              (noRag
                ? 'border-warn/60 bg-warn/10 text-warn'
                : 'border-line text-dim')
            }
          >
            noRag: {noRag ? 'вкл (без поиска по базе)' : 'выкл'}
          </span>
          <span className="text-dim">переключить: <code className="font-mono">/norag</code></span>
        </div>
        {strategy === 'telegram' && (
          <div className="mt-3 flex flex-wrap items-end gap-4">
            <label className="flex-1 text-sm">
              <span className="block text-xs uppercase tracking-wide text-dim">chatKey (-100… / @username)</span>
              <input
                className={`mt-1 w-full font-mono text-xs ${INPUT}`}
                value={chatKey}
                onChange={(e) => setChatKey(e.target.value)}
                disabled={running}
                placeholder="-1001234567890"
              />
            </label>
            <label className="text-sm">
              <span className="block text-xs uppercase tracking-wide text-dim">topicId (опц.)</span>
              <input
                className={`mt-1 w-28 ${INPUT}`}
                value={topicId}
                onChange={(e) => setTopicId(e.target.value)}
                disabled={running}
                placeholder="общий"
              />
            </label>
          </div>
        )}
      </Card>

      {/* Task state */}
      <Card label="Память задачи">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-dim">/task &lt;цель&gt; · /task-clear</span>
        </div>
        <pre className="mt-1 whitespace-pre-wrap font-sans text-xs text-ink">
          {taskStateText || '(пусто — задайте цель: /task выбрать режим прогрева)'}
        </pre>
      </Card>

      {/* История — chat-bubbles (assistant bg-surface, user bg-surface-2, без side-tab) */}
      <section
        ref={scrollRef}
        className="h-[36vh] space-y-3 overflow-y-auto rounded-md border border-line bg-bg p-4"
      >
        {messages.length === 0 && <p className="text-sm text-dim">История пуста. Спросите что-нибудь по базе знаний.</p>}
        {messages.map((m, i) => (
          <div key={i} className={`rounded-md p-3 text-sm ${m.role === 'user' ? 'bg-surface-2' : 'bg-surface'}`}>
            <div className="mb-1 font-mono text-xs uppercase tracking-wider text-dim">{m.role}</div>
            <div className="whitespace-pre-wrap text-ink">
              {m.content || (m.role === 'assistant' && running ? '…' : '')}
            </div>
          </div>
        ))}
      </section>

      {/* Источники последнего хода */}
      {(stages.length > 0 || sources.length > 0 || quotes.length > 0 || debug) && (
        <section className="space-y-2">
          {stages.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {stages.map((s, i) => (
                <span key={`${s.step}-${i}`} className="rounded-full border border-line px-2 py-0.5 text-xs text-dim">
                  {STAGE_LABEL[s.step]}
                  {s.step === 'llm' && s.detail && typeof s.detail === 'object' && 'topK' in (s.detail as object)
                    ? ` · topK=${(s.detail as { topK: number }).topK}` : ''}
                </span>
              ))}
            </div>
          )}
          {sources.length > 0 && (
            <details className="rounded-md border border-line bg-surface p-3">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-dim">Источники ({sources.length})</summary>
              <ul className="mt-2 space-y-1 text-xs">
                {sources.map((s, i) => (
                  <li key={s.chunkId} className="truncate">
                    <span className="text-dim">[{i + 1}]</span>{' '}
                    <span className="font-mono text-ink">{s.source}</span>{' '}
                    <span className="text-dim">{s.section}</span>{' '}
                    <span className="text-accent">{s.score.toFixed(3)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {quotes.length > 0 && (
            <details className="rounded-md border border-line bg-surface p-3">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-dim">Цитаты</summary>
              <ul className="mt-2 space-y-2 text-xs">
                {quotes.map((q, i) => (
                  <li key={`${q.chunkId}-${i}`}>
                    <div className="text-dim">{q.source} · {q.section}</div>
                    <div className="whitespace-pre-wrap text-ink">{q.snippet}</div>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {debug && (
            <details className="rounded-md border border-line bg-surface p-3">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-dim">Отладка</summary>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <dt className="text-dim">pool / filtered</dt><dd className="tabular-nums text-ink">{debug.poolSize} / {debug.filteredSize}</dd>
                <dt className="text-dim">threshold</dt><dd className="tabular-nums text-ink">{debug.threshold}</dd>
                <dt className="text-dim">topK</dt><dd className="tabular-nums text-ink">{debug.topK ?? '-'}</dd>
                <dt className="text-dim">guard</dt><dd className="text-ink">{debug.gaveUp ? 'сработал (не знаю)' : 'нет'}</dd>
              </dl>
            </details>
          )}
        </section>
      )}

      {error && (
        <p className="rounded border border-err/40 bg-err/10 p-2 text-sm text-err">{error}</p>
      )}

      {/* Ввод */}
      <section className="flex gap-2">
        <textarea
          className={`flex-1 resize-none p-2 ${INPUT}`}
          rows={2}
          placeholder="Вопрос по базе… (/task, /task-clear — память задачи; /norag — без RAG; Enter — отправить)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          disabled={running}
        />
        <div className="flex flex-col gap-1">
          <Button variant="primary" onClick={() => void send()} disabled={running || !input.trim()}>
            {running ? '…' : 'Спросить'}
          </Button>
          <Button variant="ghost" onClick={cancel} disabled={!running}>
            Отмена
          </Button>
        </div>
      </section>
    </div>
  );
}
