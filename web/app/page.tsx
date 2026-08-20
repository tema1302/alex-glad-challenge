// Личный продающий лендинг (/, день 36). Server Component, 0 API-вызовов.
// 5 секций: hero-личность → proof-of-work (вехи+метрики) → продукты → навыки/стек → контакты.
// Гость: proof-карточки БЕЗ href (кликабельность = login-стена), CTA — якоря (#proof,
// #contacts). Админ: плитки кликабельны + ghost «В дашборд →» + строка /showcase.
// Контент — из data/landing.ts (единственный источник), иконки — id→компонент из icons.tsx.
import Link from 'next/link';
import { type ComponentType, type CSSProperties } from 'react';
import { SectionLabel } from './components/ui/SectionLabel';
import { Card } from './components/ui/Card';
import { BentoCard } from './components/ui/BentoCard';
import {
  IconCpu,
  IconDatabase,
  IconMessages,
  IconPlug,
  IconRss,
  IconSend,
  IconSparkles,
} from './components/ui/icons';
import {
  challengeFootnote,
  challengeMetrics,
  challengeNarrative,
  contacts,
  core,
  milestones,
  person,
  principles,
  products,
  stackLine,
  type LandingIconId,
} from '../data/landing';
import { isAdminAuthed } from '../lib/server/session';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

const ICONS: Record<LandingIconId, ComponentType> = {
  database: IconDatabase,
  sparkles: IconSparkles,
  plug: IconPlug,
  send: IconSend,
  rss: IconRss,
  messages: IconMessages,
  cpu: IconCpu,
};

export default async function HomePage() {
  const isAdmin = await isAdminAuthed();

  return (
    <div className="space-y-12">
      {/* S1. Hero — кто я и что умею */}
      <section className="bento-enter" style={{ '--i': '0' } as CSSProperties}>
        <SectionLabel>{person.label}</SectionLabel>
        <h1 className="font-mono text-4xl font-semibold uppercase leading-[0.95] tracking-tight text-ink sm:text-5xl md:text-6xl">
          {person.name}
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-ink md:text-lg">
          {person.positioning}
        </p>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-dim md:text-base">{person.intro}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a
            href="#contacts"
            className={`bento-enter inline-flex min-h-[40px] items-center rounded-md bg-accent px-5 py-2 text-sm font-semibold text-accent-ink transition-filter hover:brightness-110 ${FOCUS}`}
            style={{ '--i': '1' } as CSSProperties}
          >
            Связаться
          </a>
          <a
            href="#proof"
            className={`bento-enter inline-flex min-h-[40px] items-center rounded-md border border-line-strong px-5 py-2 text-sm font-semibold text-ink transition-colors hover:border-accent ${FOCUS}`}
            style={{ '--i': '2' } as CSSProperties}
          >
            Смотреть работы ↓
          </a>
          {isAdmin && (
            <Link
              href="/dashboard"
              className={`bento-enter inline-flex min-h-[40px] items-center rounded-md px-5 py-2 text-sm font-medium text-dim transition-colors hover:text-ink ${FOCUS}`}
              style={{ '--i': '3' } as CSSProperties}
            >
              В дашборд →
            </Link>
          )}
        </div>
      </section>

      {/* S2. Proof-of-work — челлендж как доказательство */}
      <section id="proof" className="scroll-mt-20">
        <SectionLabel>{`proof · ${challengeMetrics[0].value} дней`}</SectionLabel>
        <p className="max-w-2xl text-sm leading-relaxed text-dim md:text-base">
          {challengeNarrative}
        </p>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {milestones.map((m, i) => (
            <div
              key={m.days}
              className="bento-enter rounded-2xl border border-line bg-surface p-5"
              style={{ '--i': String(i) } as CSSProperties}
            >
              <div className="font-mono text-xs uppercase tracking-wider text-accent">{m.days}</div>
              <h3 className="mt-2 font-sans text-base font-semibold text-ink">{m.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-dim">{m.desc}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {challengeMetrics.map((m, i) => (
            <div
              key={m.label}
              className="bento-enter rounded-2xl border border-line bg-surface p-5"
              style={{ '--i': String(i) } as CSSProperties}
            >
              <div className="font-mono text-4xl font-semibold tabular-nums text-accent">{m.value}</div>
              <div className="mt-2 font-mono text-xs uppercase tracking-wider text-dim">{m.label}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 font-mono text-xs text-dim">{challengeFootnote}</p>
      </section>

      {/* S3. Продукты — построено (гость: карточка-доказательство, админ: live-ссылка) */}
      <section>
        <SectionLabel>продукты · построено</SectionLabel>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 md:gap-5">
          {products.map((p, i) => {
            const Icon = ICONS[p.icon];
            return (
              <BentoCard
                key={p.badge}
                href={isAdmin ? p.href : undefined}
                badge={p.badge}
                title={p.title}
                desc={p.desc}
                icon={<Icon />}
                index={i + 1}
              />
            );
          })}
        </div>
      </section>

      {/* S4. Навыки / ядро компетенций */}
      <section>
        <SectionLabel>навыки · стек</SectionLabel>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {core.map((c, i) => {
            const Icon = ICONS[c.icon];
            return (
              <Card key={c.title}>
                <div
                  className="bento-enter flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-accent"
                  style={{ '--i': String(i) } as CSSProperties}
                >
                  <Icon /> <span>core</span>
                </div>
                <h3 className="mt-3 font-sans text-lg font-semibold text-ink">{c.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-dim">{c.desc}</p>
              </Card>
            );
          })}
        </div>
        <p className="mt-4 font-mono text-xs leading-relaxed text-dim">{stackLine}</p>
        <p className="mt-1 font-mono text-xs leading-relaxed text-dim">{principles}</p>
        {isAdmin && (
          <p className="mt-3 font-mono text-xs text-dim">
            Полный обзор —{' '}
            <Link href="/showcase" className="text-accent hover:underline">
              /showcase
            </Link>
            .
          </p>
        )}
      </section>

      {/* S5. Контакты (плейсхолдеры — правка в data/landing.ts) */}
      <section id="contacts" className="scroll-mt-20">
        <SectionLabel>контакты</SectionLabel>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {contacts.map((c, i) => (
            <div
              key={c.label}
              className="bento-enter rounded-2xl border border-line bg-surface p-5"
              style={{ '--i': String(i) } as CSSProperties}
            >
              <div className="font-mono text-xs uppercase tracking-wider text-dim">{c.label}</div>
              <a
                href={c.href}
                rel="noopener noreferrer"
                className={`mt-2 inline-block break-all font-mono text-sm text-accent hover:underline ${FOCUS}`}
              >
                {c.value}
              </a>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
