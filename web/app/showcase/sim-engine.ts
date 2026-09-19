// Чистый движок симулятора «Один день редакции» (без React): таймлайн событий
// из скрипта + редьюсер состояния. Времена — в мс при скорости 1×; драйвер в
// компоненте масштабирует их скоростью и уважает prefers-reduced-motion.
import type { SimNews, SimScript, SimTopic } from '../../data/newsroom-sim';

export type SimPhase = 'idle' | 'inbox' | 'agents' | 'brief' | 'writing' | 'publish' | 'done';

export type SimEvent =
  | { t: number; kind: 'phase'; phase: Exclude<SimPhase, 'idle'> }
  | { t: number; kind: 'log'; line: string; tone?: 'dim' | 'accent' | 'ok' }
  | { t: number; kind: 'news'; item: SimNews }
  | { t: number; kind: 'agent'; agent: string; step: number }
  | { t: number; kind: 'chars'; n: number }
  | { t: number; kind: 'metric'; views: number; reactions: number; subs: number }
  // Пауза-событие: драйвер останавливается и ждёт решения человека
  // (выбор темы / «опубликовать»), само событие в редьюсер не уходит.
  | { t: number; kind: 'ready' };

export interface SimMetrics {
  views: number;
  reactions: number;
  subs: number;
}

export interface SimState {
  phase: SimPhase;
  logs: { line: string; tone: 'dim' | 'accent' | 'ok' }[];
  inbox: SimNews[];
  agents: Record<string, number>;
  postChars: number;
  metrics: SimMetrics;
}

export function initialState(): SimState {
  return { phase: 'idle', logs: [], inbox: [], agents: {}, postChars: 0, metrics: { views: 0, reactions: 0, subs: 0 } };
}

export function applyEvent(state: SimState, ev: SimEvent): SimState {
  switch (ev.kind) {
    case 'phase':
      return { ...state, phase: ev.phase };
    case 'log':
      return { ...state, logs: [...state.logs, { line: ev.line, tone: ev.tone ?? 'dim' }] };
    case 'news':
      return { ...state, inbox: [...state.inbox, ev.item] };
    case 'agent':
      return { ...state, agents: { ...state.agents, [ev.agent]: ev.step } };
    case 'chars':
      return { ...state, postChars: ev.n };
    case 'metric':
      return { ...state, metrics: { views: ev.views, reactions: ev.reactions, subs: ev.subs } };
    case 'ready':
      return state;
  }
}

export type SimReducer = (state: SimState, ev: SimEvent) => SimState;

// ── Таймлайны ────────────────────────────────────────────────────────────────

// Утро: лента сыплется, скауты работают параллельно (реплики чередуются),
// оркестратор собирает топ → ожидание выбора редактора.
export function buildTimeline(script: SimScript): SimEvent[] {
  const ev: SimEvent[] = [];
  let t = 0;
  ev.push({ t, kind: 'phase', phase: 'inbox' });
  ev.push({ t, kind: 'log', line: '09:00 · редакция на связи, RSS-шлюз открыт' });
  script.feed.forEach((item, i) => {
    t = 250 + i * 170;
    ev.push({ t, kind: 'news', item });
  });
  t += 260;
  ev.push({ t, kind: 'log', line: `10:00 · в ленте ${script.feed.length} материалов — скауты вышли на охоту` });
  ev.push({ t, kind: 'phase', phase: 'agents' });
  const maxLogs = Math.max(...script.agents.map((a) => a.logs.length));
  for (let li = 0; li < maxLogs; li++) {
    for (const a of script.agents) {
      if (li >= a.logs.length) continue;
      t += 200;
      ev.push({ t, kind: 'log', line: `${a.name}: ${a.logs[li]}`, tone: li === a.logs.length - 1 ? 'ok' : 'dim' });
      ev.push({ t, kind: 'agent', agent: a.id, step: li + 1 });
    }
  }
  t += 320;
  ev.push({ t, kind: 'log', line: '10:40 · оркестратор собрал топ-3. Тему выпуска выбирает редактор', tone: 'accent' });
  ev.push({ t, kind: 'phase', phase: 'brief' });
  ev.push({ t: t + 80, kind: 'ready' });
  return ev;
}

// Выбор сделан: LLM пишет пост за выбранную тему по буквам → фактчек →
// ожидание кнопки «Опубликовать».
export function buildChoiceTimeline(script: SimScript, topicId: string): SimEvent[] {
  const topic = script.topics.find((x) => x.id === topicId);
  const post = script.posts[topicId];
  if (!topic || !post) return [];
  const ev: SimEvent[] = [];
  let t = 0;
  ev.push({ t, kind: 'log', line: `11:00 · пишем: «${topic.title}»`, tone: 'accent' });
  ev.push({ t, kind: 'phase', phase: 'writing' });
  for (let n = 44; n < post.body.length; n += 44) {
    t += 90;
    ev.push({ t, kind: 'chars', n });
  }
  t += 140;
  ev.push({ t, kind: 'chars', n: post.body.length });
  t += 300;
  ev.push({ t, kind: 'log', line: '11:20 · фактчек: источники на месте, вода слита', tone: 'ok' });
  ev.push({ t: t + 80, kind: 'ready' });
  return ev;
}

// «Опубликовать»: пост уходит в канал, метрики тикают до финальных значений.
export function buildPublishTimeline(script: SimScript): SimEvent[] {
  const ev: SimEvent[] = [];
  let t = 0;
  ev.push({ t, kind: 'phase', phase: 'publish' });
  ev.push({ t, kind: 'log', line: '12:00 · пост уходит в канал…' });
  t += 500;
  ev.push({ t, kind: 'log', line: 'доставлено: читатели канала', tone: 'ok' });
  const ticks = 4;
  for (let i = 1; i <= ticks; i++) {
    t += 240;
    ev.push({
      t,
      kind: 'metric',
      views: Math.round((script.final.views * i) / ticks),
      reactions: Math.round((script.final.reactions * i) / ticks),
      subs: Math.round((script.final.subs * i) / ticks),
    });
  }
  t += 320;
  ev.push({ t, kind: 'log', line: `выпуск ${script.issue} готов — день закрыт`, tone: 'accent' });
  ev.push({ t, kind: 'phase', phase: 'done' });
  return ev;
}

/** Тема топа по id (для панели выбора). */
export function topicById(topics: SimTopic[], id: string | null): SimTopic | undefined {
  return id ? topics.find((x) => x.id === id) : undefined;
}
