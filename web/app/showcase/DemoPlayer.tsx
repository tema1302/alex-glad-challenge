'use client';

// DemoPlayer — мини-демо в карточке витрины: пользователь кликает фразу-выбор,
// «система» отвечает пузырём с доказательствами (чипы). Без LLM: реплики из
// capability-demos.ts. prefers-reduced-motion → задержки схлопываются.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DemoScript } from '../../data/capability-demos';
import { Button } from '../components/ui/Button';
import { useTimeoutQueue } from '../components/arcade/use-timeouts';

interface Msg {
  who: 'user' | 'bot';
  text: string;
  chips?: string[];
}

export function DemoPlayer({ script }: { script: DemoScript }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [beat, setBeat] = useState(0);
  const [thinking, setThinking] = useState(false);
  const reducedRef = useRef(false);
  const { set: setTimer, clearAll: clearTimers } = useTimeoutQueue();
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    reducedRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [msgs.length, thinking]);

  const ask = useCallback(
    (phrase: string): void => {
      const b = script.beats[beat];
      if (!b || thinking) return;
      setMsgs((m) => [...m, { who: 'user', text: phrase }]);
      setThinking(true);
      setTimer(
        () => {
          setMsgs((m) => [...m, { who: 'bot', text: b.reply, chips: b.chips }]);
          setThinking(false);
          setBeat((x) => x + 1);
        },
        reducedRef.current ? 120 : 750,
      );
    },
    [beat, script, thinking, setTimer],
  );

  const restart = useCallback((): void => {
    clearTimers();
    setMsgs([]);
    setBeat(0);
    setThinking(false);
  }, [clearTimers]);

  const done = beat >= script.beats.length;
  const asks = done ? [] : script.beats[beat]!.ask;

  return (
    <div className="mt-3 rounded-lg border border-line bg-bg/40 p-3">
      <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-dim">{script.intro}</p>
      <div ref={listRef} className="max-h-56 space-y-2 overflow-y-auto pr-1" aria-live="polite">
        {msgs.map((m, i) =>
          m.who === 'user' ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] rounded-lg rounded-br-sm border border-accent-dim bg-accent/10 px-2.5 py-1.5 text-sm text-ink">
                {m.text}
              </p>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div className="max-w-[92%] rounded-lg rounded-bl-sm border border-line bg-surface-2/70 px-2.5 py-1.5">
                <p className="text-sm leading-relaxed text-ink">{m.text}</p>
                {m.chips && m.chips.length > 0 && (
                  <ul className="mt-1.5 flex flex-wrap gap-1">
                    {m.chips.map((c) => (
                      <li
                        key={c}
                        className="rounded border border-ok/40 px-1.5 py-0.5 font-mono text-[10px] text-ok"
                      >
                        {c}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ),
        )}
        {thinking && (
          <div className="flex justify-start" aria-label="система печатает">
            <span className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface-2/70 px-2.5 py-2">
              <span className="spin inline-block h-3 w-3 rounded-full border border-line border-t-accent" aria-hidden="true" />
              <span className="font-mono text-[10px] text-dim">печатает…</span>
            </span>
          </div>
        )}
        {msgs.length === 0 && !thinking && <p className="py-3 text-sm text-dim">Кликните фразу ниже — и смотрите ответ.</p>}
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {asks.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => ask(a)}
            disabled={thinking}
            className="min-h-[32px] max-md:min-h-[40px] rounded-full border border-line bg-surface px-3 text-xs font-medium text-dim transition-all duration-base ease-system hover:-translate-y-0.5 hover:border-accent-dim hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim disabled:cursor-not-allowed disabled:opacity-50"
          >
            {a}
          </button>
        ))}
        {done && (
          <Button size="sm" onClick={restart}>
            Заново
          </Button>
        )}
      </div>
    </div>
  );
}
