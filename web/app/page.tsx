// Лендинг v3 «Paper × Aurora» (полная переделка с нуля): светлая продающая
// страница — тёплая бумага, дисплейный Unbounded, aurora-градиенты, сгенериро-
// ванные SVG-иллюстрации. Продающая структура: оффер+арт → стек → контраст
// «обычные каналы vs этот» → bento-возможности с артами → путь читателя →
// тёмный proof-бенд → «попробовать сейчас» → манифест → FAQ → финальный CTA.
// Server Component, 0 client-JS, 0 новых deps. Изоляция световой темы — класс
// .lp (globals.css); админка остаётся в тёмных токенах. Гость: артефакты без
// href (анти-утечка маршрутов); админ: плитки кликабельны + «В дашборд».
// Все CTA — только через SubscribeButton (правило v2 сохранено).
import Link from 'next/link';
import type { Metadata } from 'next';
import { type ComponentType } from 'react';
import { SubscribeButton } from './components/landing/SubscribeButton';
import { CountUp } from './components/CountUp';
import { ScrollSpin } from './components/ScrollSpin';
import {
  ArtDash,
  ArtGateway,
  ArtJira,
  ArtMemory,
  ArtMcp,
  ArtPipeline,
  ArtRag,
  ArtTg,
  HeroCore,
  HeroRings,
} from './components/landing/art';
import {
  IconCheck,
  IconExternal,
  IconTelegram,
  IconX,
} from './components/ui/icons';
import {
  artifacts,
  challengeNarrative,
  channel,
  channelPoints,
  compare,
  contactLinks,
  faq,
  journey,
  offer,
  offerMeta,
  person,
  proofMetrics,
  quote,
  stackLine,
  tryItems,
  type LandingIconId,
} from '../data/landing';
import { isAdminAuthed } from '../lib/server/session';

export const metadata: Metadata = {
  title: `${person.name} — ${person.role}`,
  description: offerMeta.metaDescription,
  openGraph: {
    title: `${person.name} — ${person.role}`,
    description: offerMeta.metaDescription,
    type: 'website',
  },
};

const ICONS: Record<LandingIconId, ComponentType> = {
  database: () => <ArtRag />,
  sparkles: () => <ArtJira />,
  plug: () => <ArtMcp />,
  send: () => <ArtTg />,
  rss: () => <ArtPipeline />,
  messages: () => <ArtMemory />,
  cpu: () => <ArtGateway />,
  telegram: () => <ArtTg />,
};

const FEATURE_ART: Record<string, ComponentType> = {
  rag: () => <ArtRag />,
  mcp: () => <ArtMcp />,
  gateway: () => <ArtGateway />,
  tg: () => <ArtTg />,
  memory: () => <ArtMemory />,
  dash: () => <ArtDash />,
};

const CHANNEL_URL_TEXT = channel.url.replace(/^https?:\/\//, '');

// Орбитальные чипы hero: живые ссылки на соответствующие разделы.
// guestHref — публичная альтернатива для гостя (без логина): чип «RAG-поиск»
// ведёт на демо-страницу /demo, админ попадает в полный /rag/chat. Для чипов
// без guestHref защищённые маршруты по-прежнему отдаёт middleware
// (302 → /login?next=…), после входа человек попадает именно туда, куда тыкнул.
type OrbitLink = {
  label: string;
  href: string;
  guestHref?: string;
  dot: string;
  pos: string;
  float: string;
};

const ORBIT_LINKS: readonly OrbitLink[] = [
  {
    label: 'RAG-поиск',
    href: '/rag/chat',
    guestHref: '/demo',
    dot: 'bg-brand-600',
    pos: 'left-1/2 top-[13%] -translate-x-1/2',
    float: '',
  },
  { label: 'MCP-серверы', href: '/mcp/tools', dot: 'bg-brand-600', pos: 'right-[1%] top-[30%]', float: 'lp-float' },
  { label: 'TG-юзербот', href: '/tg/top', dot: 'bg-brand-600', pos: 'left-[1%] bottom-[26%]', float: 'lp-float-2 lp-float' },
  { label: 'Память', href: '/chat', dot: 'bg-brand-mint', pos: 'right-[7%] bottom-[23%]', float: 'lp-float-3 lp-float' },
];

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-paper';

// Секционный лейбл светового мира: «// NN · label» в брендовом цвете.
function LpLabel({ n, label }: { n: string; label: string }) {
  return (
    <div className="font-mono text-xs uppercase tracking-[0.22em] text-brand-600">
      {`// ${n} · ${label}`}
    </div>
  );
}

export default async function HomePage() {
  const isAdmin = await isAdminAuthed();

  return (
    <div className="lp">
      {/* ═══ S1. HERO — оффер + арт (конверсия в первом экране) ═══ */}
      <section className="relative overflow-hidden">
        <div className="lp-grid-bg absolute inset-0" aria-hidden="true" />
        <div className="lp-blob lp-blob-violet -top-24 right-[8%] h-96 w-96" aria-hidden="true" />
        <div className="lp-blob lp-blob-mint top-40 left-[-6%] h-80 w-80" aria-hidden="true" />

        <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pb-20 pt-14 md:pb-28 md:pt-20 lg:grid-cols-[1.02fr_0.98fr]">
          <div>
            <a
              href={channel.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`lp-chip transition-colors duration-fast hover:border-brand-300 hover:text-brand-600 ${FOCUS}`}
            >
              <span className="relative inline-flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-600" />
              </span>
              {`Канал · ${channel.handle}`}
            </a>

            <h1 className="mt-6 max-w-[19ch] font-display text-[clamp(1.75rem,3.6vw,2.85rem)] font-bold leading-[1.1] tracking-tight text-p-ink">
              {offer.headline.split('—')[0]}— <span className="lp-gradient-text">{offer.headline.split('—')[1]}</span>
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-relaxed text-p-dim">{offer.subhead}</p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <SubscribeButton href={channel.url} label={channel.subscribeLabel} className="w-full justify-center sm:w-auto" />
              <a
                href="#built"
                className={`inline-flex min-h-[52px] w-full whitespace-nowrap items-center justify-center rounded-full border border-p-ink/15 bg-paper-2 px-7 text-base font-semibold text-p-ink transition-all duration-base ease-system hover:-translate-y-0.5 hover:border-brand-300 sm:w-auto ${FOCUS}`}
              >
                Смотреть, что внутри ↓
              </a>
              {isAdmin && (
                <Link href="/dashboard" className={`whitespace-nowrap px-2 text-base font-medium text-p-dim transition-colors hover:text-p-ink ${FOCUS}`}>
                  В дашборд →
                </Link>
              )}
            </div>

            <dl className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-3">
              {proofMetrics.rest.map((m) => (
                <div key={m.label} className="flex items-baseline gap-2">
                  <dt className="sr-only">{m.label}</dt>
                  <dd className="font-display text-2xl font-bold text-p-ink">{m.value}</dd>
                  <dd className="font-mono text-[11px] uppercase tracking-wider text-p-dim">{m.label}</dd>
                </div>
              ))}
              <div className="flex items-baseline gap-2">
                <dt className="sr-only">бесплатно</dt>
                <dd className="font-display text-2xl font-bold text-brand-600">0₽</dd>
                <dd className="font-mono text-[11px] uppercase tracking-wider text-p-dim">навсегда</dd>
              </div>
            </dl>
          </div>

          <div className="relative mx-auto aspect-square w-full max-w-[560px]">
            {/* Орбиты — вращаются от скролла; чипы-ссылки и ядро — статичны. */}
            <ScrollSpin className="absolute inset-0 text-p-ink" speed={0.05}>
              <HeroRings className="h-full w-full" />
            </ScrollSpin>
            <HeroCore className="absolute inset-0" />
            {ORBIT_LINKS.map((l) => (
              <Link
                key={l.label}
                href={!isAdmin && l.guestHref ? l.guestHref : l.href}
                title={`${l.label} — открыть раздел`}
                className={`z-10 absolute inline-flex items-center gap-2 rounded-full border border-p-line bg-paper-2 px-4 py-2 text-sm font-semibold text-p-ink shadow-card transition-all duration-base ease-system hover:-translate-y-0.5 hover:border-brand-300 hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${l.pos} ${l.float}`}
              >
                <span aria-hidden="true" className={`h-2 w-2 rounded-full ${l.dot}`} />
                {l.label}
              </Link>
            ))}
          </div>
        </div>

        {/* стек — тонкая полоса доверия */}
        <div className="relative border-t border-p-line/70 bg-paper-2/60">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-x-3 gap-y-2 px-5 py-5">
            {stackLine.split(' · ').map((t) => (
              <span key={t} className="lp-chip">
                {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ S2. КОНТРАСТ — обычные каналы vs этот ═══ */}
      <section className="l-reveal">
        <div className="mx-auto w-full max-w-6xl px-5 py-20 md:py-28">
          <LpLabel n="01" label="почему подписаться" />
          <h2 className="mt-4 max-w-2xl font-display text-[clamp(1.5rem,3vw,2.25rem)] font-bold leading-tight tracking-tight text-p-ink">
            Контента про AI много. <span className="lp-gradient-text">Кода — мало.</span>
          </h2>

          <div className="mt-10 grid gap-5 md:grid-cols-2">
            {/* они */}
            <div className="rounded-[20px] border border-p-line bg-paper-2/50 p-7">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-p-ink/5 text-p-dim">
                  <IconX className="h-4 w-4" />
                </span>
                <h3 className="font-display text-lg font-semibold text-p-dim">{compare.them.title}</h3>
              </div>
              <ul className="mt-5 space-y-3.5">
                {compare.them.points.map((p) => (
                  <li key={p} className="flex items-start gap-3 text-[15px] leading-relaxed text-p-dim">
                    <span aria-hidden="true" className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-p-dim/40" />
                    {p}
                  </li>
                ))}
              </ul>
            </div>

            {/* мы */}
            <div className="lp-card relative border-brand-200 p-7">
              <div className="lp-blob lp-blob-indigo -right-10 -top-10 h-40 w-40" aria-hidden="true" />
              <div className="relative flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-600 to-brand-violet text-white">
                  <IconCheck className="h-4 w-4" />
                </span>
                <h3 className="font-display text-lg font-semibold text-p-ink">{compare.us.title}</h3>
              </div>
              <ul className="relative mt-5 space-y-3.5">
                {compare.us.points.map((p) => (
                  <li key={p} className="flex items-start gap-3 text-[15px] font-medium leading-relaxed text-p-ink">
                    <span aria-hidden="true" className="mt-1 text-brand-600">
                      <IconCheck className="h-4 w-4" />
                    </span>
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ S3. BENTO-ВОЗМОЖНОСТИ — что уже построено (с артами) ═══ */}
      <section id="built" className="l-reveal scroll-mt-16">
        <div className="mx-auto w-full max-w-6xl px-5 py-20 md:py-24">
          <LpLabel n="02" label="что уже построено" />
          <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
            <h2 className="max-w-xl font-display text-[clamp(1.5rem,3vw,2.25rem)] font-bold leading-tight tracking-tight text-p-ink">
              Шесть систем, которые <span className="lp-gradient-text">работают прямо сейчас</span>
            </h2>
            <p className="max-w-sm text-sm leading-relaxed text-p-dim">
              Каждая собрана с нуля и живёт в одном репозитории. У админа плитки кликабельны — витрина и есть интерфейс.
            </p>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {artifacts.map((a, i) => {
              const Art = FEATURE_ART[a.art] ?? ICONS[a.icon];
              const wide = i === 0 || i === 3; // RAG и TG — широкие, композиция «текст + арт»
              const inner = (
                <>
                  <div className={`flex gap-6 ${wide ? 'flex-row items-center' : 'flex-col'}`}>
                    <div className={wide ? 'min-w-0 flex-1' : ''}>
                      <span className="lp-chip !text-brand-600">{a.tag}</span>
                      <h3 className="mt-4 font-display text-xl font-semibold text-p-ink">{a.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-p-dim">{a.desc}</p>
                    </div>
                    <div className={wide ? 'w-44 shrink-0 md:w-52' : 'mt-2'}>
                      <Art />
                    </div>
                  </div>
                  <div className={`mt-auto flex items-center gap-2 pt-4 font-mono text-xs ${isAdmin ? 'text-brand-600' : 'text-p-dim/60'}`}>
                    {isAdmin ? (
                      <>
                        Открыть <IconExternal className="h-3.5 w-3.5" />
                      </>
                    ) : (
                      'разбор — в канале'
                    )}
                  </div>
                </>
              );
              const cls = `lp-card flex flex-col p-6 ${wide ? 'md:col-span-2' : ''} ${FOCUS}`;
              return a.href && isAdmin ? (
                <Link key={a.tag} href={a.href} aria-label={`Открыть ${a.title}`} className={`${cls} group`}>
                  {inner}
                </Link>
              ) : (
                <article key={a.tag} className={cls}>
                  {inner}
                </article>
              );
            })}

            {/* мини-CTA заполняет сетку */}
            <div className="relative flex flex-col justify-between overflow-hidden rounded-[20px] bg-panel p-6 text-white">
              <div className="lp-blob lp-blob-violet -right-8 -top-8 h-36 w-36 opacity-70" aria-hidden="true" />
              <div className="lp-blob lp-blob-mint -bottom-10 -left-6 h-32 w-32 opacity-50" aria-hidden="true" />
              <p className="relative font-display text-lg font-semibold leading-snug">
                Разборы каждой —{' '}
                <span className="lp-gradient-text">в канале</span>
              </p>
              <div className="relative mt-4">
                <SubscribeButton href={channel.url} label={channel.subscribeLabel} variant="inline" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ S4. ПУТЬ ЧИТАТЕРА — 4 шага ═══ */}
      <section className="l-reveal border-y border-p-line/70 bg-paper-2/60">
        <div className="mx-auto w-full max-w-6xl px-5 py-20 md:py-24">
          <LpLabel n="03" label="как читать канал" />
          <h2 className="mt-4 font-display text-[clamp(1.5rem,3vw,2.25rem)] font-bold leading-tight tracking-tight text-p-ink">
            От поста до своей системы — <span className="lp-gradient-text">четыре шага</span>
          </h2>

          <ol className="mt-12 grid gap-8 md:grid-cols-4 md:gap-5">
            {journey.map((j) => (
              <li key={j.n} className="relative">
                <div className="font-display text-4xl font-bold text-brand-200">{j.n}</div>
                <div className="mt-3 h-px w-full bg-gradient-to-r from-brand-400/60 to-transparent" />
                <h3 className="mt-4 font-display text-base font-semibold text-p-ink">{j.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-p-dim">{j.desc}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ═══ S5. ТЁМНЫЙ PROOF-БЕНД — цифры в контрастной вставке ═══ */}
      <section className="l-reveal">
        <div className="mx-auto w-full max-w-6xl px-5 py-20 md:py-24">
          <div className="relative overflow-hidden rounded-[28px] bg-panel px-6 py-14 text-white md:px-14 md:py-20">
            <div className="lp-blob lp-blob-violet -left-16 -top-16 h-80 w-80" aria-hidden="true" />
            <div className="lp-blob lp-blob-mint -bottom-20 -right-10 h-80 w-80" aria-hidden="true" />
              <div className="relative">
                <div className="font-mono text-xs uppercase tracking-[0.22em] text-brand-300">
                  {'// proof · в цифрах'}
                </div>
                <div className="mt-8 grid items-end gap-10 lg:grid-cols-[auto_1fr] lg:gap-16">
                  <div>
                    <div className="font-display text-[clamp(4.5rem,9vw,8rem)] font-bold leading-none">
                      <CountUp value={proofMetrics.dominant.value} />
                    </div>
                    <div className="mt-3 font-mono text-xs uppercase tracking-[0.2em] text-white/60">
                      {proofMetrics.dominant.label}
                    </div>
                  </div>
                  <p className="max-w-xl text-base leading-relaxed text-white/70 md:text-lg">
                    {challengeNarrative}
                  </p>
                </div>
                <div className="mt-12 grid grid-cols-3 gap-6 border-t border-white/10 pt-8">
                  {proofMetrics.rest.map((m) => (
                    <div key={m.label}>
                      <div className="font-display text-2xl font-bold md:text-4xl">
                        <CountUp value={m.value} />
                      </div>
                      <div className="mt-1 font-mono text-[11px] uppercase tracking-wider text-white/50">{m.label}</div>
                    </div>
                  ))}
                </div>
              </div>
          </div>
        </div>
      </section>

      {/* ═══ S6. ПОПРОБОВАТЬ СЕЙЧАС — публичные интерактивы ═══ */}
      <section className="l-reveal">
        <div className="mx-auto w-full max-w-6xl px-5 py-20 md:py-24">
          <LpLabel n="04" label="без подписки" />
          <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
            <h2 className="font-display text-[clamp(1.5rem,3vw,2.25rem)] font-bold leading-tight tracking-tight text-p-ink">
              Попробовать <span className="lp-gradient-text">прямо сейчас</span>
            </h2>
            <p className="max-w-sm text-sm leading-relaxed text-p-dim">
              Живые инструменты открыты без логина — потрогайте, прежде чем подписываться.
            </p>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {tryItems.map((t) => {
              const Icon = ICONS[t.icon];
              return (
                <Link
                  key={t.tag}
                  href={t.href}
                  className={`lp-card group flex flex-col p-6 ${FOCUS}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="lp-chip !text-brand-600">{t.tag}</span>
                    <span aria-hidden="true" className="text-p-dim/50 transition-all duration-base ease-system group-hover:translate-x-1 group-hover:text-brand-600">
                      →
                    </span>
                  </div>
                  <div className="mt-4 w-full [&_svg]:max-h-32">
                    <Icon />
                  </div>
                  <h3 className="mt-4 font-display text-base font-semibold text-p-ink">{t.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-p-dim">{t.desc}</p>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* ═══ S7. МАНИФЕСТ ═══ */}
      <section className="l-reveal border-y border-p-line/70 bg-paper-2/60">
        <div className="mx-auto w-full max-w-3xl px-5 py-20 text-center md:py-24">
          <div aria-hidden="true" className="font-display text-6xl font-bold leading-none lp-gradient-text">
            «
          </div>
          <blockquote className="mt-2 font-display text-xl font-medium leading-relaxed text-p-ink md:text-2xl">
            {quote.text}
          </blockquote>
          <footer className="mt-6 font-mono text-xs uppercase tracking-wider text-p-dim">
            {quote.author} · {quote.role}
          </footer>
        </div>
      </section>

      {/* ═══ S8. FAQ — снятие возражений ═══ */}
      <section className="l-reveal">
        <div className="mx-auto w-full max-w-3xl px-5 py-20 md:py-24">
          <LpLabel n="05" label="вопросы" />
          <h2 className="mt-4 font-display text-[clamp(1.5rem,3vw,2.25rem)] font-bold leading-tight tracking-tight text-p-ink">
            Частые вопросы
          </h2>
          <div className="lp-faq lp-card mt-8 px-6 py-2">
            {faq.map((f) => (
              <details key={f.q} className="group">
                <summary className="text-[15px] md:text-base">{f.q}</summary>
                <p className="pb-5 pr-8 text-sm leading-relaxed text-p-dim">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ S9. ФИНАЛЬНЫЙ CTA — градиентная панель ═══ */}
      <section className="l-reveal">
        <div className="mx-auto w-full max-w-6xl px-5 pb-20 md:pb-28">
          <div className="relative overflow-hidden rounded-[32px] bg-panel px-6 py-16 text-center text-white md:px-14 md:py-24">
            <div className="lp-blob lp-blob-violet left-1/2 -top-24 h-96 w-[42rem] -translate-x-1/2" aria-hidden="true" />
            <div className="lp-blob lp-blob-mint bottom-[-6rem] right-[-4rem] h-72 w-72" aria-hidden="true" />
            <div className="relative mx-auto max-w-2xl">
              <div className="font-mono text-xs uppercase tracking-[0.22em] text-brand-300">
                {'// канал'}
              </div>
              <h2 className="mt-5 font-display text-[clamp(1.6rem,3.4vw,2.6rem)] font-bold leading-tight tracking-tight">
                Соберите свой AI-стэк <span className="lp-gradient-text">с картой, а не вслепую</span>
              </h2>
              <ul className="mx-auto mt-8 max-w-md space-y-3 text-left">
                {channelPoints.map((p) => (
                  <li key={p} className="flex items-start gap-3 text-sm leading-relaxed text-white/80 md:text-base">
                    <span aria-hidden="true" className="mt-0.5 text-brand-mint">
                      <IconCheck className="h-4 w-4" />
                    </span>
                    {p}
                  </li>
                ))}
              </ul>
              <div className="mt-10 flex flex-col items-center gap-4">
                <SubscribeButton href={channel.url} label={channel.subscribeLabel} />
                <span className="font-mono text-xs text-white/50">{CHANNEL_URL_TEXT}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="border-t border-p-line bg-paper-2/60">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-8 gap-y-3 px-5 py-8">
          <div>
            <div className="font-display text-sm font-semibold text-p-ink">
              {person.name} <span className="text-brand-600">·</span> <span className="font-normal text-p-dim">{person.role}</span>
            </div>
            <div className="mt-1 font-mono text-[11px] text-p-dim/70">© 2026 · Next.js 15 · React 19</div>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-xs">
            <a
              href={channel.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center gap-1.5 text-p-dim transition-colors hover:text-brand-600 ${FOCUS}`}
            >
              <IconTelegram />
              {CHANNEL_URL_TEXT}
            </a>
            {contactLinks.map((c) => (
              <a key={c.label} href={c.href} className={`text-p-dim transition-colors hover:text-brand-600 ${FOCUS}`}>
                {c.value}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
