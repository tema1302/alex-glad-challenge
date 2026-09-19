// Движок симулятора «Один день редакции»: таймлайны монотонны и доходят до
// ready; скауты работают параллельно; редьюсер корректно копит состояние.
import { describe, expect, it } from 'vitest';
import { newsroomScript } from '../../data/newsroom-sim';
import {
  applyEvent,
  buildChoiceTimeline,
  buildPublishTimeline,
  buildTimeline,
  initialState,
  topicById,
} from '../../app/showcase/sim-engine';

describe('buildTimeline', () => {
  const tl = buildTimeline(newsroomScript);

  it('время монотонно не убывает, события идут фазами по порядку', () => {
    let t = -1;
    const phases: string[] = [];
    for (const ev of tl) {
      expect(ev.t).toBeGreaterThanOrEqual(t);
      t = ev.t;
      if (ev.kind === 'phase') phases.push(ev.phase);
    }
    expect(phases).toEqual(['inbox', 'agents', 'brief']);
  });

  it('реплики агентов чередуются (параллельная работа), шаги синхронны с логами', () => {
    const authors = tl.filter((e) => e.kind === 'log' && e.line.includes(':')).map((e) => (e.kind === 'log' ? e.line.split(':')[0] : ''));
    // как минимум два разных автора в первой тройке реплик
    expect(new Set(authors.slice(0, 3)).size).toBeGreaterThanOrEqual(2);
    // на каждый log-шаг агента есть соседнее событие agent с тем же шагом
    const agentSteps = tl.filter((e) => e.kind === 'agent');
    expect(agentSteps).toHaveLength(newsroomScript.agents.reduce((n, a) => n + a.logs.length, 0));
  });

  it('лента целиком попадает в состояние, финал — ready (ждём редактора)', () => {
    expect(tl.at(-1)?.kind).toBe('ready');
    let s = initialState();
    for (const ev of tl) {
      if (ev.kind === 'ready') break;
      s = applyEvent(s, ev);
    }
    expect(s.inbox).toHaveLength(newsroomScript.feed.length);
    expect(s.phase).toBe('brief');
  });
});

describe('выбор темы и публикация', () => {
  it('таймлайн письма раскрывает пост выбранной темы до конца и останавливается на ready', () => {
    const topic = newsroomScript.topics[0]!;
    const tl = buildChoiceTimeline(newsroomScript, topic.id);
    expect(tl).not.toHaveLength(0);
    expect(tl.at(-1)?.kind).toBe('ready');
    const chars = tl.filter((e) => e.kind === 'chars');
    const last = chars.at(-1);
    expect(last && last.kind === 'chars' ? last.n : 0).toBe(newsroomScript.posts[topic.id]!.body.length);
  });

  it('неизвестная тема → пустой таймлайн (страховка от чужих id)', () => {
    expect(buildChoiceTimeline(newsroomScript, 'nope')).toHaveLength(0);
  });

  it('публикация: финальные метрики равны script.final, фаза done', () => {
    const tl = buildPublishTimeline(newsroomScript);
    let s = initialState();
    for (const ev of tl) s = applyEvent(s, ev);
    expect(s.phase).toBe('done');
    expect(s.metrics).toEqual(newsroomScript.final);
  });
});

describe('applyEvent', () => {
  it('не мутирует прошлое состояние и копит лог/ленту иммутабельно', () => {
    const s0 = initialState();
    const s1 = applyEvent(s0, { t: 0, kind: 'log', line: 'утро' });
    const s2 = applyEvent(s1, { t: 1, kind: 'news', item: newsroomScript.feed[0]! });
    expect(s0.logs).toHaveLength(0);
    expect(s1.logs).toHaveLength(1);
    expect(s2.inbox).toHaveLength(1);
    expect(s1.inbox).toHaveLength(0);
  });

  it('ready — нейтральное событие: состояние не меняется', () => {
    const s = applyEvent(initialState(), { t: 0, kind: 'ready' });
    expect(s).toEqual(initialState());
  });
});

describe('topicById', () => {
  it('находит тему по id и терпит null', () => {
    expect(topicById(newsroomScript.topics, 'local-llm')?.title).toContain('Локальная');
    expect(topicById(newsroomScript.topics, null)).toBeUndefined();
  });
});
