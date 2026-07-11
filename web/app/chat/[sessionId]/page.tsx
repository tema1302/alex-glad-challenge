// /chat/[sessionId] — chat-агент: стрим ответа, панель управления (strategy/system/memory/usage/reset).
// 'use client': load сессии (GET) + SSE-стрим (POST) + PATCH настроек. Без импортов core/.
// Сессия переживает reload: история и настройки в web-sessions.sqlite (server flush после реплики).
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { SseEvent, SseUsage } from '../../../lib/shared/sse';
import type { StrategyName } from '../../../lib/shared/forms';
import { useModelPrefDefault } from '../../../lib/shared/use-model-pref';
import { MemoryPanel } from './panels/MemoryPanel';
import { BranchesPanel } from './panels/BranchesPanel';
import { ProfilePanel } from './panels/ProfilePanel';
import { ConstraintsPanel } from './panels/ConstraintsPanel';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

type PanelTab = 'memory' | 'branches' | 'profile' | 'constraints';

type Role = 'user' | 'assistant' | 'system';

interface SessionMessage {
  role: Role;
  content: string;
  ts: string;
}

interface SessionConfig {
  id: string;
  strategy: StrategyName;
  system: string;
  memoryEnabled: boolean;
  windowSize: number;
}

const STRATEGY_OPTIONS: Array<{ value: StrategyName; label: string }> = [
  { value: 'full', label: 'full (вся история)' },
  { value: 'sliding', label: 'sliding (окно)' },
  { value: 'sticky', label: 'sticky (факты + окно)' },
  { value: 'branching', label: 'branching (ветки)' },
];

const INPUT =
  'rounded border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink placeholder:text-dim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent';

export default function ChatSessionPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;

  const [config, setConfig] = useState<SessionConfig | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [usage, setUsage] = useState<SseUsage | null>(null);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Редактируемый system (локальный draft; сохраняется в сессию по кнопке).
  const [systemDraft, setSystemDraft] = useState('');
  const [savingSystem, setSavingSystem] = useState(false);
  const [llm, setLlm] = useState<'local' | 'cloud'>('local');
  // follow-up P5: дефолт llm-селектора — из preference (cookie model_pref через /api/settings).
  useModelPrefDefault(setLlm);
  const [panel, setPanel] = useState<PanelTab | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // --- load session on mount / sessionId change ---
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setConfig(null);
    setMessages([]);
    setUsage(null);
    fetch(`/api/chat/${sessionId}`)
      .then(async (r) => {
        if (!r.ok) {
          setLoadError(`HTTP ${r.status}`);
          return null;
        }
        return r.json() as Promise<{ session: { id: string; strategy: StrategyName; system: string; memoryEnabled: boolean; windowSize: number; messages: SessionMessage[]; usage: SseUsage } }>;
      })
      .then((data) => {
        if (cancelled || !data) return;
        const s = data.session;
        setConfig({ id: s.id, strategy: s.strategy, system: s.system, memoryEnabled: s.memoryEnabled, windowSize: s.windowSize });
        setSystemDraft(s.system);
        setMessages(s.messages.filter((m) => m.role !== 'system'));
        setUsage(s.usage);
      })
      .catch(() => { if (!cancelled) setLoadError('network error'); });
    return () => { cancelled = true; };
  }, [sessionId]);

  // --- autoscroll ---
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const patchConfig = useCallback(async (patch: Partial<SessionConfig>): Promise<void> => {
    const resp = await fetch(`/api/chat/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = (await resp.json()) as { session: { strategy: StrategyName; system: string; memoryEnabled: boolean; windowSize: number } };
    setConfig((prev) => prev ? { ...prev, strategy: data.session.strategy, system: data.session.system, memoryEnabled: data.session.memoryEnabled, windowSize: data.session.windowSize } : prev);
    setSystemDraft(data.session.system);
  }, [sessionId]);

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
      const resp = await fetch(`/api/chat/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, llm }),
        signal: ac.signal,
      });
      if (!resp.ok || !resp.body) {
        const txt = await resp.text().catch(() => '');
        setError(`HTTP ${resp.status}: ${txt.slice(0, 200)}`);
        setMessages((p) => p.slice(0, -1)); // откатить пустую assistant-реплику
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
        setError('Отменено');
      } else {
        setError(e instanceof Error ? e.message : 'request failed');
        setMessages((p) => p.slice(0, -1));
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [input, running, sessionId, llm]);

  const cancel = (): void => { abortRef.current?.abort(); };

  const onReset = async (): Promise<void> => {
    if (running) return;
    if (!confirm('Сбросить историю и usage этой сессии? (system/long-term сохранятся)')) return;
    try {
      const resp = await fetch(`/api/chat/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset: true }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      setMessages([]);
      setUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'reset failed');
    }
  };

  if (loadError) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-err">Сессия не загружена: {loadError}</p>
        <Link href="/chat" className="text-sm text-accent hover:underline">← к списку сессий</Link>
      </div>
    );
  }

  if (!config) {
    return <p className="text-sm text-dim">Загрузка сессии…</p>;
  }

  const tabBtn = (active: boolean): string =>
    'rounded px-2 py-1 text-xs transition-colors ' +
    (active ? 'bg-accent text-accent-ink' : 'border border-line-strong text-dim hover:text-ink');

  return (
    <div className="space-y-4">
      <section className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Chat-агент</h1>
          <p className="mt-1 font-mono text-xs text-dim">{config.id}</p>
        </div>
        <Link href="/chat" className="text-sm text-accent hover:underline">сессии</Link>
      </section>

      {/* Панель управления */}
      <Card label="Параметры">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-dim">Стратегия</span>
            <select
              className={`mt-1 ${INPUT}`}
              value={config.strategy}
              onChange={(e) => patchConfig({ strategy: e.target.value as StrategyName }).catch((e) => setError(e instanceof Error ? e.message : 'fail'))}
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
              onChange={(e) => setLlm(e.target.value as 'local' | 'cloud')}
              disabled={running}
            >
              <option value="local">local (Ollama)</option>
              <option value="cloud">cloud</option>
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={config.memoryEnabled}
              onChange={(e) => patchConfig({ memoryEnabled: e.target.checked }).catch((err) => setError(err instanceof Error ? err.message : 'fail'))}
              disabled={running}
            />
            memory mode (3 слоя)
          </label>

          <div className="ml-auto flex items-center gap-3">
            {usage && (
              <span className="font-mono text-xs text-dim tabular-nums">
                Σ {usage.total_tokens} (↑{usage.prompt_tokens}/↓{usage.completion_tokens})
              </span>
            )}
            <button
              className="rounded border border-line-strong px-2 py-1 text-xs text-dim transition-colors hover:text-ink disabled:opacity-50"
              onClick={onReset}
              disabled={running}
            >
              reset
            </button>
          </div>
        </div>

        <label className="mt-3 block text-sm">
          <span className="block text-xs uppercase tracking-wide text-dim">System-промпт</span>
          <textarea
            className={`mt-1 w-full resize-y p-2 ${INPUT}`}
            rows={2}
            value={systemDraft}
            onChange={(e) => setSystemDraft(e.target.value)}
            disabled={running}
          />
        </label>
        <div className="mt-1 flex justify-end">
          <button
            className="rounded border border-line-strong px-2 py-1 text-xs text-dim transition-colors hover:text-ink disabled:opacity-50"
            onClick={() => {
              setSavingSystem(true);
              patchConfig({ system: systemDraft })
                .then(() => setSavingSystem(false))
                .catch((e) => { setError(e instanceof Error ? e.message : 'fail'); setSavingSystem(false); });
            }}
            disabled={running || savingSystem || systemDraft === config.system}
          >
            {savingSystem ? 'сохраняю…' : 'сохранить system'}
          </button>
        </div>
      </Card>

      {/* Панели P2b: memory / branches / profile / constraints. Опциональные, не блокируют чат. */}
      <section className="rounded-md border border-line bg-surface">
        <div className="flex flex-wrap gap-1 border-b border-line p-2">
          {(['memory', 'profile', 'constraints'] as PanelTab[]).map((t) => (
            <button
              key={t}
              className={tabBtn(panel === t)}
              onClick={() => setPanel((p) => (p === t ? null : t))}
            >
              {t}
            </button>
          ))}
          {config.strategy === 'branching' && (
            <button
              className={tabBtn(panel === 'branches')}
              onClick={() => setPanel((p) => (p === 'branches' ? null : 'branches'))}
            >
              branches
            </button>
          )}
        </div>
        {panel === 'memory' && <div className="p-3"><MemoryPanel sessionId={sessionId} /></div>}
        {panel === 'branches' && config.strategy === 'branching' && <div className="p-3"><BranchesPanel sessionId={sessionId} /></div>}
        {panel === 'profile' && <div className="p-3"><ProfilePanel sessionId={sessionId} /></div>}
        {panel === 'constraints' && <div className="p-3"><ConstraintsPanel sessionId={sessionId} /></div>}
      </section>

      {/* История — chat-bubbles (assistant bg-surface, user bg-surface-2, без side-tab) */}
      <section
        ref={scrollRef}
        className="h-[40vh] space-y-3 overflow-y-auto rounded-md border border-line bg-bg p-4"
      >
        {messages.length === 0 && (
          <p className="text-sm text-dim">История пуста. Отправьте сообщение ниже.</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`rounded-md p-3 text-sm ${m.role === 'user' ? 'bg-surface-2' : 'bg-surface'}`}>
            <div className="mb-1 font-mono text-xs uppercase tracking-wider text-dim">{m.role}</div>
            <div className="whitespace-pre-wrap text-ink">
              {m.content || (m.role === 'assistant' && running ? '…' : '')}
            </div>
          </div>
        ))}
      </section>

      {error && (
        <p className="rounded border border-err/40 bg-err/10 p-2 text-sm text-err">{error}</p>
      )}

      {/* Ввод */}
      <section className="flex gap-2">
        <textarea
          className={`flex-1 resize-none p-2 ${INPUT}`}
          rows={2}
          placeholder="Сообщение… (Enter — отправить, Shift+Enter — перенос)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
          }}
          disabled={running}
        />
        <div className="flex flex-col gap-1">
          <Button variant="primary" onClick={() => void send()} disabled={running || !input.trim()}>
            {running ? '…' : 'Отправить'}
          </Button>
          <Button variant="ghost" onClick={cancel} disabled={!running}>
            Отмена
          </Button>
        </div>
      </section>
    </div>
  );
}
