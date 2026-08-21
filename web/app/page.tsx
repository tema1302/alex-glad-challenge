// Личный продающий лендинг v2 (/, landing-v2). Направление D1 «Инженерный бродсайд»:
// гигантский mono-оффер, линейки-«главы» 01/02/03, ноль декоративных фонов (единственный
// glow — за финальной CTA-панелью). Единая макро-конверсия — подписка на Telegram-канал;
// артефакты = доказательство. 4 секции: hero-оффер → proof → артефакты → финальный CTA.
// Server Component, client-директив 0, API-вызовов 0. Контент — из data/landing.ts (v2),
// иконки — id→компонент из icons.tsx (8, включая telegram). Контейнерами владеет страница
// (гостевая ветка layout — main без контейнера); админ видит `/` в каркасе — D1 деградирует.
// Гость: карточки-артефакты БЕЗ href, secondary-CTA — якорь #proof (не login-стена).
// Админ: плитки кликабельны + ghost «В дашборд →» + строка /showcase.
import Link from 'next/link';
import type { Metadata } from 'next';
import { type ComponentType, type CSSProperties } from 'react';
import { SectionLabel } from './components/ui/SectionLabel';
import { BentoCard } from './components/ui/BentoCard';
import { SectionShell } from './components/landing/SectionShell';
import { SubscribeButton } from './components/landing/SubscribeButton';
import { FinalCta } from './components/landing/FinalCta';
import {
  IconCpu,
  IconDatabase,
  IconMessages,
  IconPlug,
  IconRss,
  IconSend,
  IconSparkles,
  IconTelegram,
} from './components/ui/icons';
import {
  artifacts,
  challengeNarrative,
  channel,
  channelPoints,
  contactLinks,
  milestones,
  offer,
  offerMeta,
  person,
  proofMetrics,
  stackLine,
  type LandingIconId,
} from '../data/landing';
import { isAdminAuthed } from '../lib/server/session';

// page-local metadata: тон подписки, число 36 (layout-description — генеральный fallback).
// openGraph НЕ добавляем: без metadataBase Next даёт build-warning; OG-изображений нет (CSP).
export const metadata: Metadata = {
  title: `${person.name} — ${person.role}`,
  description: offerMeta.metaDescription,
};

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
  telegram: IconTelegram,
};

// t.me/<handle> — доверие к пункту назначения под кнопками (из channel.url, без протокола).
const CHANNEL_URL_TEXT = channel.url.replace(/^https?:\/\//, '');

export default async function HomePage() {
  const isAdmin = await isAdminAuthed();

  return (
    <>
      {/* S1. Hero — оффер + primary-CTA (CTA обязан попасть в первый viewport 375×667) */}
      <section>
        <div className="mx-auto w-full max-w-6xl px-5 pb-16 pt-10 md:pb-24 md:pt-20">
          <div className="bento-enter" style={{ '--i': '0' } as CSSProperties}>
            <SectionLabel>{`${person.name} · ${person.role} · ${proofMetrics.dominant.value} дней челленджа`}</SectionLabel>
          </div>
          <h1
            className="bento-enter mt-4 font-mono text-[clamp(2rem,6.5vw,4.5rem)] font-semibold uppercase leading-[0.95] tracking-tight text-ink"
            style={{ '--i': '1' } as CSSProperties}
          >
            {offer.headline}
          </h1>
          <p
            className="bento-enter mt-5 max-w-xl text-base leading-relaxed text-dim md:text-lg"
            style={{ '--i': '2' } as CSSProperties}
          >
            {offer.subhead}
          </p>
          <div
            className="bento-enter mt-8 flex flex-wrap gap-3"
            style={{ '--i': '3' } as CSSProperties}
          >
            <SubscribeButton href={channel.url} label={channel.subscribeLabel} />
            <a
              href="#proof"
              className={`inline-flex min-h-[44px] items-center rounded-md border border-line-strong px-6 text-sm font-semibold text-ink transition-colors hover:border-accent ${FOCUS}`}
            >
              Смотреть, что построено ↓
            </a>
            {isAdmin && (
              <Link
                href="/dashboard"
                className={`inline-flex min-h-[44px] items-center rounded-md px-5 text-sm font-medium text-dim transition-colors hover:text-ink ${FOCUS}`}
              >
                В дашборд →
              </Link>
            )}
          </div>
          <p
            className="bento-enter mt-4 font-mono text-xs text-dim"
            style={{ '--i': '4' } as CSSProperties}
          >
            {CHANNEL_URL_TEXT}
          </p>
        </div>
      </section>

      {/* S2. Proof — сжатое доказательство (доминанта 36 + лог-строки вех + inline-CTA) */}
      <div className="l-reveal">
        <SectionShell n="01" label={`proof · ${proofMetrics.dominant.value} дней`} id="proof">
          <p className="max-w-2xl text-sm leading-relaxed text-dim md:text-base">
            {challengeNarrative}
          </p>
          <div className="mt-10 flex flex-col gap-8 md:flex-row md:items-end md:gap-12">
            <div>
              <div className="font-mono text-7xl font-semibold leading-none tabular-nums text-ink md:text-8xl">
                {proofMetrics.dominant.value}
              </div>
              <div className="mt-3 font-mono text-xs uppercase tracking-wider text-dim">
                {proofMetrics.dominant.label}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 md:gap-8">
              {proofMetrics.rest.map((m) => (
                <div key={m.label}>
                  <div className="font-mono text-2xl font-semibold tabular-nums text-ink md:text-3xl">
                    {m.value}
                  </div>
                  <div className="mt-1 font-mono text-xs uppercase tracking-wider text-dim">
                    {m.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-12">
            {milestones.map((m) => (
              <div
                key={m.days}
                className="flex flex-col gap-1 border-t border-line py-4 sm:flex-row sm:gap-8"
              >
                <div className="w-24 shrink-0 pt-1 font-mono text-xs uppercase tracking-wider text-dim">
                  {m.days}
                </div>
                <div>
                  <h3 className="font-sans text-base font-semibold text-ink">{m.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-dim">{m.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-8">
            <SubscribeButton href={channel.url} label={channel.subscribeLabel} variant="inline" />
          </div>
        </SectionShell>
      </div>

      {/* S3. Артефакты — products+core слиты (гость: карточка-доказательство, админ: live-ссылка) */}
      <div className="l-reveal">
        <SectionShell n="02" label="артефакты · построено">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 md:gap-5">
            {artifacts.map((a, i) => {
              const Icon = ICONS[a.icon];
              return (
                <BentoCard
                  key={a.tag}
                  href={isAdmin ? a.href : undefined}
                  badge={a.tag}
                  title={a.title}
                  desc={a.desc}
                  icon={<Icon />}
                  index={i + 1}
                />
              );
            })}
          </div>
          <p className="mt-4 font-mono text-xs leading-relaxed text-dim">{stackLine}</p>
          {isAdmin && (
            <p className="mt-3 font-mono text-xs text-dim">
              Полный обзор —{' '}
              <Link href="/showcase" className="text-accent hover:underline">
                /showcase
              </Link>
              .
            </p>
          )}
        </SectionShell>
      </div>

      {/* S4. Финальный CTA — glow-панель «Что будет в канале» + плоская строка контактов */}
      <div className="l-reveal">
        <SectionShell n="03" label="канал">
          <FinalCta heading="Что будет в канале" points={channelPoints}>
            <SubscribeButton href={channel.url} label={channel.subscribeLabel} />
            <span className="font-mono text-xs text-dim">{CHANNEL_URL_TEXT}</span>
          </FinalCta>
          <p className="mt-6 flex flex-wrap gap-x-5 gap-y-2 font-mono text-xs text-dim">
            {contactLinks.map((c) => (
              <a
                key={c.label}
                href={c.href}
                rel="noopener noreferrer"
                className={`underline-offset-2 transition-colors hover:text-accent hover:underline ${FOCUS}`}
              >
                {`${c.label}: ${c.value}`}
              </a>
            ))}
          </p>
        </SectionShell>
      </div>
    </>
  );
}
