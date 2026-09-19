'use client';
// Чат-панель RAG-агента по чату Evolute: SSE /api/evolute/agent (stage/token/done).
// История — в памяти страницы (без DialogDb: refresh сбрасывает, сессии не нужны).
// Поиск на сервере жёстко скоупирован на chatKey Evolute (strategy=telegram).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RagStageStep, SseEvent, SseSource } from '../../lib/shared/sse';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { INPUT_CLASS } from '../components/ui/Field';
import { SectionHead } from '../components/ui/SectionHead';

type Llm = 'local' | 'cloud';

interface UxMessage {
  role: 'user' | 'assistant';
  content: string;
}

const STAGE_LABEL: Record<RagStageStep, string> = {
  rewrite: 'переформулировка',
  retrieve: 'поиск',
  filter: 'фильтр',
  rerank: 'реранк',
  guard: 'guard',
  llm: 'генерация',
};

/** chunkId tg::<chat>::<topic>::<A>-<B> → ссылка на первое сообщение диапазона. */
function chunkLink(chunkId: string): string | null {
  const m = chunkId.match(/^tg::-100(\d+)::(\d+)::(\d+)/);
  if (!m) return null;
  return `https://t.me/c/${m[1]}/${m[2]}/${m[3]}`;
}

export function EvoluteAgent() {
  const [messages, setMessages] = useState<UxMessage[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [llm, setLlm] = useState<Llm>('local');
  const [noRag, setNoRag] = useState(false);
  const [stages, setStages] = useState<Array<{ step: RagStageStep; detail?: unknown }>>([]);
  const [sources, setSources] = useState<SseSource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = useCallback(async (): Promise<void> => {
    const raw = input.trim();
    if (!raw || running) return;
    setError(null);
    setRunning(true);
    setInput('');
    setStages([]);
    setSources([]);

    const history = messages.slice(-10).map((m) => ({ role: m.role, content: m.content }));
    setMessages((p) => [...p, { role: 'user', content: raw }, { role: 'assistant', content: '' }]);

    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const resp = await fetch('/api/evolute/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: raw, history, llm, noRag }),
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
          try {
            ev = JSON.parse(dataLine) as SseEvent;
          } catch {
            continue;
          }
          if (ev.type === 'stage') {
            setStages((p) => [...p, { step: ev.step, detail: ev.detail }]);
          } else if (ev.type === 'token') {
            setMessages((p) => {
              const next = p.slice();
              const last = next[next.length - 1];
              next[next.length - 1] = { ...last, content: last.content + ev.delta };
              return next;
            });
          } else if (ev.type === 'done') {
            setSources(ev.sources ?? []);
            if (ev.answer != null) {
              setMessages((p) => {
                const next = p.slice();
                const last = next[next.length - 1];
                next[next.length - 1] = { ...last, content: ev.answer ?? last.content };
                return next;
              });
            }
          } else if (ev.type === 'error') {
            setError(ev.message);
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setError(e instanceof Error ? e.message : 'network error');
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [input, running, messages, llm, noRag]);

  const stop = useCallback((): void => {
    abortRef.current?.abort();
  }, []);

  return (
    <div className="space-y-3">
      <SectionHead
        code="evolute · agent"
        title="Агент по чату"
        description="Ищет по индексу чата Evolute (RAG) и отвечает со ссылками на источники. История учитывается в пределах страницы."
      />
      <Card label={`agent · ${llm}${noRag ? ' · без базы' : ''}`}
        actions={
          <div className="flex items-center gap-2 font-mono text-xs">
            <button
              type="button"
              onClick={() => setLlm(llm === 'local' ? 'cloud' : 'local')}
              className="rounded-md border border-line px-2 py-1 text-dim transition-colors duration-fast hover:border-accent-dim hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              {llm === 'local' ? 'локальная модель' : 'cloud'}
            </button>
            <button
              type="button"
              onClick={() => setNoRag((v) => !v)}
              className={`rounded-md border px-2 py-1 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                noRag ? 'border-accent-dim text-accent' : 'border-line text-dim hover:border-accent-dim'
              }`}
            >
              без базы
            </button>
          </div>
        }
      >
        <div
          ref={scrollRef}
          className="max-h-[420px] space-y-3 overflow-y-auto rounded-lg border border-line/60 bg-surface-2/40 p-3"
        >
          {messages.length === 0 && (
            <p className="text-sm text-dim">
              Спросите что-нибудь по чату: «какие проблемы со стояночным тормозом?», «что советуют про
              зимнюю эксплуатацию?», «сколько просили за машину у дилеров летом?»
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
              <div className="font-mono text-[10px] uppercase tracking-wider text-dim">
                {m.role === 'user' ? 'вы' : 'агент'}
              </div>
              <div
                className={`mt-1 inline-block max-w-[92%] whitespace-pre-wrap rounded-lg px-3 py-2 text-left text-sm ${
                  m.role === 'user'
                    ? 'bg-accent/10 text-ink'
                    : 'border border-line/60 bg-surface text-ink'
                }`}
              >
                {m.content || (running && i === messages.length - 1 ? '…' : '')}
              </div>
            </div>
          ))}
        </div>

        {stages.length > 0 && (
          <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-dim">
            {stages.map((s) => STAGE_LABEL[s.step] ?? s.step).join(' → ')}
          </p>
        )}
        {sources.length > 0 && (
          <div className="mt-2 space-y-1">
            {sources.map((s) => {
              const url = chunkLink(s.chunkId);
              return (
                <div key={s.chunkId} className="font-mono text-[11px] text-dim">
                  <span className="text-accent">{s.score.toFixed(3)}</span> · {s.section}
                  {url && (
                    <>
                      {' · '}
                      <a href={url} target="_blank" rel="noreferrer" className="underline decoration-line hover:text-accent">
                        открыть в TG ↗
                      </a>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {error && <p className="mt-2 text-sm text-err">{error}</p>}

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <textarea
            className={`min-h-[48px] flex-1 ${INPUT_CLASS}`}
            placeholder="Вопрос по чату Evolute… (Enter — отправить, Shift+Enter — перенос)"
            value={input}
            disabled={running}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {running ? (
            <Button variant="ghost" onClick={stop}>
              стоп
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void send()} disabled={!input.trim()}>
              спросить
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
