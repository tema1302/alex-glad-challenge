// Витрина (/showcase): продуктовая страница — герой-питч, полоса фактов,
// симулятор выпуска, у каждой системы живое мини-демо (DemoPlayer), аркада.
// Копирайт — язык результата без dev-жаргона. Контент: web/data/showcase.ts,
// сценарии демо: web/data/capability-demos.ts, цифры: web/data/landing.ts.
import { architectureLayers, capabilitySections, stack, webChokepoint } from '../../data/showcase';
import { capabilityDemos } from '../../data/capability-demos';
import { proofMetrics } from '../../data/landing';
import { Card } from '../components/ui/Card';
import { SectionLabel } from '../components/ui/SectionLabel';
import { ShowcaseArcade } from '../components/arcade/ShowcaseArcade';
import { NewsroomSim } from './NewsroomSim';
import { DemoPlayer } from './DemoPlayer';

export const metadata = {
  title: 'Витрина — Иди на факты глянь',
};

const HERO_FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

export default function ShowcasePage() {
  return (
    <div className="space-y-10">
      {/* Герой: за одну секунду ясно, что это и что делать */}
      <section>
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-accent">core · витрина системы</p>
        <h1 className="mt-3 max-w-3xl font-sans text-2xl font-bold leading-tight tracking-tight text-ink sm:text-3xl md:text-4xl">
          Система, которая сама ведёт канал: собирает новости,{' '}
          <span className="text-accent">отвечает на вопросы</span> и публикует посты
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-dim">
          Это не слайды — всё на странице запущено прямо сейчас. Тыкайте: проведите один день редакции или спросите базу знаний.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a
            href="#sim"
            className={`inline-flex min-h-[48px] items-center rounded-md bg-accent px-5 text-sm font-semibold text-accent-ink transition-colors duration-fast hover:bg-accent/90 ${HERO_FOCUS}`}
          >
            ▶ Запустить выпуск
          </a>
          <a
            href="/demo"
            className={`inline-flex min-h-[48px] items-center rounded-md border border-line-strong px-5 text-sm font-semibold text-dim transition-colors duration-fast hover:border-accent-dim hover:text-ink ${HERO_FOCUS}`}
          >
            Спросить базу знаний →
          </a>
        </div>
      </section>

      {/* Полоса фактов: конкретика вместо обещаний */}
      <section>
        <SectionLabel>система в фактах</SectionLabel>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[proofMetrics.dominant, ...proofMetrics.rest].map((m) => (
            <Card key={m.label}>
              <div className="font-mono text-2xl font-semibold text-ink">{m.value}</div>
              <div className="mt-1 text-xs leading-snug text-dim">{m.label}</div>
            </Card>
          ))}
        </div>
      </section>

      {/* Флагман: интерактивный прогон дня редакции — решение редактора, пост, выпуск */}
      <section id="sim" className="scroll-mt-16">
        <SectionLabel>симулятор · один день редакции</SectionLabel>
        <p className="mt-3 max-w-2xl text-sm text-dim">
          Нажмите «Запустить день» — и за минуту пройдёте путь выпуска: утренняя лента, скауты, ваш выбор темы, готовый пост.
        </p>
        <div className="mt-4">
          <NewsroomSim />
        </div>
      </section>

      <section>
        <SectionLabel>потыкайте сами · каждая система в деле</SectionLabel>
        <p className="mb-4 mt-3 max-w-2xl text-sm text-dim">
          У каждой системы — живой пример: кликните фразу и посмотрите ответ с доказательствами.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {capabilitySections.map((s) => (
            <Card key={s.id} label={s.title}>
              <div className="flex items-baseline gap-2">
                <span aria-hidden>{s.icon}</span>
                <p className="text-sm text-dim">{s.summary}</p>
              </div>
              <ul className="mt-3 space-y-2">
                {s.items.slice(0, 2).map((it) => (
                  <li key={it.title} className="text-sm">
                    <span className="font-medium text-ink">{it.title}.</span>{' '}
                    <span className="text-dim">{it.detail}</span>
                  </li>
                ))}
              </ul>
              <DemoPlayer script={capabilityDemos[s.id] ?? { intro: '', beats: [] }} />
            </Card>
          ))}
        </div>
      </section>

      <section>
        <SectionLabel>аркада · играй и узнавай</SectionLabel>
        <ShowcaseArcade />
      </section>

      <section>
        <SectionLabel>как устроено</SectionLabel>
        <p className="mb-3 max-w-2xl text-sm text-dim">
          Три слоя и один репозиторий: от клика в браузере — до строки в локальной базе.
        </p>
        <Card>
          <ol className="space-y-3">
            {architectureLayers.map((layer, idx) => (
              <li key={layer.name} className="border-l border-line pl-3">
                <div className="font-mono text-sm text-ink">
                  <span className="text-dim">{String(idx + 1).padStart(2, '0')}</span> {layer.name}
                </div>
                <div className="mt-0.5 text-xs text-dim">{layer.role}</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {layer.nodes.map((n) => (
                    <span
                      key={n}
                      className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-dim"
                    >
                      {n}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </section>

      <section>
        <SectionLabel>безопасность</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-2">
          {webChokepoint.map((n) => (
            <Card key={n.title} label={n.title}>
              <p className="text-sm text-dim">{n.detail}</p>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <SectionLabel>начинка</SectionLabel>
        <div className="grid gap-4 sm:grid-cols-2">
          {stack.map((g) => (
            <Card key={g.name} label={g.name}>
              <ul className="flex flex-wrap gap-1.5">
                {g.items.map((it) => (
                  <li
                    key={it}
                    className="rounded bg-surface-2 px-2 py-0.5 font-mono text-xs text-dim"
                  >
                    {it}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
