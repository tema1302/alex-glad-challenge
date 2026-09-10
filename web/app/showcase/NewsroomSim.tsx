'use client';

// Симулятор «Один день редакции»: большой интерактив на витрине. Драйвер
// таймлайна (setTimeout-цепочка) гонит события из sim-engine; на «ready» машина
// останавливается и ждёт решения человека (тема выпуска → «опубликовать»).
// Учебная симуляция: LLM/RSS/Telegram не вызываются, данные выдуманы (см.
// web/data/newsroom-sim.ts). prefers-reduced-motion → все паузы схлопываются.
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { newsroomScript, type SimTopic } from '../../data/newsroom-sim';
import {
  applyEvent,
  buildChoiceTimeline,
  buildPublishTimeline,
  buildTimeline,
  initialState,
  type SimEvent,
  type SimPhase,
} from './sim-engine';
import { Button } from '../components/ui/Button';
import { IconCheck, IconSend } from '../components/ui/icons';

const PHASE_STEPS: { id: SimPhase; label: string }[] = [
  { id: 'inbox', label: 'утро · лента' },
  { id: 'agents', label: 'разведка' },
  { id: 'brief', label: 'решение' },
  { id: 'writing', label: 'написание' },
  { id: 'publish', label: 'выпуск' },
];

const fmt = new Intl.NumberFormat('ru-RU');

type SimAction = SimEvent | { kind: 'reset' };

function simReducer(state: ReturnType<typeof initialState>, action: SimAction): ReturnType<typeof initialState> {
  return action.kind === 'reset' ? initialState() : applyEvent(state, action);
}

const AGENT_LABEL: Record<string, string> = {
  rss: 'RSS-скаут',
  forum: 'Форум-скаут',
  tg: 'TG-скаут',
};

export function NewsroomSim() {
  const [state, dispatch] = useReducer(simReducer, undefined, initialState);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState<1 | 2>(1);
  const [paused, setPaused] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);

  const queueRef = useRef<SimEvent[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const reducedRef = useRef(false);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    reducedRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Лог дожимает прокрутку к свежей строке.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [state.logs.length]);

  const step = useCallback((): void => {
    const [ev, ...rest] = queueRef.current;
    if (!ev || ev.kind === 'ready') {
      queueRef.current = ev ? rest : [];
      setRunning(false);
      return;
    }
    queueRef.current = rest;
    dispatch(ev);
    const next = rest[0];
    if (!next) {
      setRunning(false);
      return;
    }
    const dt = reducedRef.current ? 0 : (next.t - ev.t) / speedRef.current;
    timerRef.current = setTimeout(step, Math.max(16, Math.min(dt, 1200)));
  }, []);

  const play = useCallback(
    (events: SimEvent[]): void => {
      if (timerRef.current) clearTimeout(timerRef.current);
      queueRef.current = events;
      setPaused(false);
      setRunning(true);
      step();
    },
    [step],
  );

  const start = useCallback((): void => {
    setChosen(null);
    play(buildTimeline(newsroomScript));
  }, [play]);

  const choose = useCallback(
    (topic: SimTopic): void => {
      setChosen(topic.id);
      play(buildChoiceTimeline(newsroomScript, topic.id));
    },
    [play],
  );

  const publish = useCallback((): void => {
    play(buildPublishTimeline(newsroomScript));
  }, [play]);

  const restart = useCallback((): void => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setRunning(false);
    setPaused(false);
    setChosen(null);
    queueRef.current = [];
    dispatch({ kind: 'reset' });
  }, []);

  const togglePause = useCallback((): void => {
    setPaused((p) => {
      if (p) {
        step();
        return false;
      }
      if (timerRef.current) clearTimeout(timerRef.current);
      return true;
    });
  }, [step]);

  const post = chosen ? newsroomScript.posts[chosen] : null;
  // done — за пределами шагов: день закрыт, значит все шаги пройдены.
  const phaseIdx = state.phase === 'done' ? PHASE_STEPS.length : PHASE_STEPS.findIndex((p) => p.id === state.phase);

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-panel">
      {/* Шапка симулятора */}
      <div className="relative border-b border-line bg-surface-2/60 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-xs uppercase tracking-wider text-accent">выпуск {newsroomScript.issue} · симуляция</div>
            <h3 className="mt-1 font-sans text-lg font-semibold text-ink">Один день редакции — от ленты до поста в канале</h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {running ? (
              <>
                <Button size="sm" onClick={togglePause}>
                  {paused ? 'Дальше' : 'Пауза'}
                </Button>
                <Button
                  size="sm"
                  onClick={() => setSpeed((s) => (s === 1 ? 2 : 1))}
                  aria-pressed={speed === 2}
                  className={speed === 2 ? '!border-accent-dim !text-accent' : ''}
                >
                  {speed}×
                </Button>
              </>
            ) : (
              <Button variant="primary" size="sm" onClick={state.phase === 'idle' ? start : restart}>
                {state.phase === 'idle' ? '▶ Запустить день' : 'Заново'}
              </Button>
            )}
          </div>
        </div>
        {/* Степпер дня */}
        <ol className="mt-4 flex flex-wrap gap-1.5">
          {PHASE_STEPS.map((p, i) => {
            const done = phaseIdx > i;
            const active = state.phase === p.id;
            return (
              <li
                key={p.id}
                aria-current={active ? 'step' : undefined}
                className={`rounded-full border px-2.5 py-0.5 font-mono text-[11px] transition-colors duration-fast ease-system ${
                  active
                    ? 'border-accent bg-accent/15 text-ink'
                    : done
                      ? 'border-ok/50 text-ok'
                      : 'border-line text-dim'
                }`}
              >
                {done && <IconCheck className="mr-1 inline h-3 w-3 align-[-1px]" />}
                {p.label}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="grid gap-0 lg:grid-cols-[1fr_1.1fr]">
        {/* Дневной лог */}
        <div className="border-b border-line lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between px-4 pt-3">
            <span className="font-mono text-[11px] uppercase tracking-wider text-dim">дневник редакции</span>
            {running && <span className="font-mono text-[11px] text-accent">{paused ? 'пауза' : 'идёт день…'}</span>}
          </div>
          <div
            ref={logRef}
            className="h-56 overflow-y-auto px-4 pb-3 pt-2 lg:h-[19rem]"
            aria-live="polite"
            aria-label="Журнал событий дня"
          >
            {state.logs.length === 0 ? (
              <p className="text-sm text-dim">День ещё не начат. Нажмите «Запустить день».</p>
            ) : (
              <ul className="space-y-1 font-mono text-xs leading-relaxed">
                {state.logs.map((l, i) => (
                  <li
                    key={i}
                    className={
                      l.tone === 'accent' ? 'text-accent' : l.tone === 'ok' ? 'text-ok' : 'text-dim'
                    }
                  >
                    <span aria-hidden="true" className="mr-1.5 text-line-strong">›</span>
                    {l.line}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Панель фазы */}
        <div className="min-h-[16rem] p-4">
          {state.phase === 'idle' && (
            <div className="flex h-full flex-col justify-center gap-3">
              <p className="text-sm leading-relaxed text-dim">
                За минуту — весь путь утреннего выпуска: лента, три агента-скаута, ваше решение, пост, канал.
              </p>
              <ul className="space-y-1.5 text-sm text-ink">
                <li>▸ лента падает на экран в реальном времени</li>
                <li>▸ скауты работают параллельно, лог — слева</li>
                <li>▸ тему выпуска и публикацию выбираете вы</li>
              </ul>
              <p className="font-mono text-[11px] text-dim">учебная симуляция: данные выдуманы, LLM не вызывается</p>
            </div>
          )}

          {state.phase === 'inbox' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-wider text-dim">
                <span>входящая лента</span>
                <span className="text-accent">{state.inbox.length}</span>
              </div>
              <ul className="space-y-1.5">
                {state.inbox.map((n, i) => (
                  <li key={i} className="flex items-baseline gap-2 rounded-md border border-line bg-surface-2/60 px-2.5 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{n.title}</span>
                    <span className="shrink-0 font-mono text-[10px] text-dim">{n.source}</span>
                    <span className="shrink-0 font-mono text-[11px] text-accent">{n.score.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(state.phase === 'agents' || state.phase === 'brief') && (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-3">
                {newsroomScript.agents.map((a) => {
                  const done = state.agents[a.id] ?? 0;
                  return (
                    <div key={a.id} className={`rounded-lg border p-2.5 ${done >= a.logs.length ? 'border-ok/40' : 'border-line'}`}>
                      <div className="font-mono text-[11px] text-dim">{AGENT_LABEL[a.id] ?? a.name}</div>
                      <div className="mt-1.5 flex gap-1" aria-label={`прогресс: ${done} из ${a.logs.length}`}>
                        {a.logs.map((_, i) => (
                          <span
                            key={i}
                            aria-hidden="true"
                            className={`h-1.5 w-full rounded-full ${i < done ? 'bg-accent' : 'bg-line'}`}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              {state.phase === 'brief' && (
                <div className="space-y-2">
                  <p className="font-mono text-[11px] uppercase tracking-wider text-accent">ваш ход: выберите тему выпуска</p>
                  {newsroomScript.topics.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => choose(t)}
                      className={`block w-full rounded-lg border p-3 text-left transition-all duration-base ease-system focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim ${
                        chosen === t.id
                          ? 'border-accent bg-accent/10'
                          : 'border-line bg-surface hover:-translate-y-0.5 hover:border-accent-dim'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-ink">{t.title}</span>
                        <span className="shrink-0 font-mono text-xs text-accent">{t.score}</span>
                      </div>
                      <p className="mt-1 text-xs text-dim">{t.why}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {state.phase === 'writing' && post && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-wider text-dim">черновик поста</span>
                <span className="font-mono text-[11px] text-accent">
                  {state.postChars}/{post.body.length}
                </span>
              </div>
              <h4 className="text-sm font-semibold text-ink">{post.title}</h4>
              <p className="min-h-[7rem] whitespace-pre-wrap text-sm leading-relaxed text-ink">
                {post.body.slice(0, state.postChars)}
                <span aria-hidden="true" className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-accent align-text-bottom" />
              </p>
              {state.postChars >= post.body.length && (
                <Button variant="primary" size="sm" icon={<IconSend />} onClick={publish}>
                  Опубликовать в канал
                </Button>
              )}
            </div>
          )}

          {state.phase === 'publish' && (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <span className="spin mx-auto block h-8 w-8 rounded-full border-2 border-line border-t-accent" aria-hidden="true" />
                <p className="mt-3 text-sm text-dim">уходим в канал…</p>
              </div>
            </div>
          )}

          {state.phase === 'done' && (
            <div className="space-y-4">
              <p className="flex items-center gap-2 text-sm text-ok">
                <IconCheck className="h-4 w-4" />
                Выпуск {newsroomScript.issue} опубликован.
              </p>
              <dl className="grid grid-cols-3 gap-2">
                {[
                  ['просмотры', state.metrics.views],
                  ['реакции', state.metrics.reactions],
                  ['новые подписчики', state.metrics.subs],
                ].map(([label, v]) => (
                  <div key={label as string} className="rounded-lg border border-line bg-surface-2/60 p-2.5 text-center">
                    <dd className="font-mono text-lg font-semibold text-ink">{fmt.format(v as number)}</dd>
                    <dt className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-dim">{label}</dt>
                  </div>
                ))}
              </dl>
              <p className="text-sm text-dim">Разборы реальных выпусков и инструментов — в канале.</p>
              <Button size="sm" onClick={restart}>
                Провести ещё один день
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
