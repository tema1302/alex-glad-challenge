// Публичная витрина харнеса (/harness) — три сборки одного ядра: харнес внутри
// Claude Code, адаптер CLI-агента, универсальное ядро для любой модели.
// Server Component: контент — статичный импорт из web/data/harness.ts, единственный
// client-компонент — CopyButton (копирование шаблона). Страница одинакова для гостя
// и админа; контейнерами владеет страница (гостевая ветка layout — main без контейнера).
import type { Metadata } from 'next';
import { SectionShell } from '../components/landing/SectionShell';
import { SectionLabel } from '../components/ui/SectionLabel';
import { Card } from '../components/ui/Card';
import { CopyButton } from './CopyButton';
import { harnessLead, harnessMeta, harnessTemplates } from '../../data/harness';

// page-local metadata (openGraph НЕ добавляем: без metadataBase — build-warning).
export const metadata: Metadata = {
  title: harnessMeta.title,
  description: harnessMeta.description,
};

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

export default function HarnessPage() {
  return (
    <>
      {/* Hero: тезис + формула + якорная навигация по трём шаблонам */}
      <section>
        <div className="mx-auto w-full max-w-6xl px-5 pb-12 pt-10 md:pb-16 md:pt-20">
          <SectionLabel>{harnessLead.label}</SectionLabel>
          <h1 className="font-mono text-3xl font-semibold uppercase leading-[0.95] tracking-tight text-ink md:text-5xl">
            {harnessLead.headline}
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-dim md:text-base">
            {harnessLead.subhead}
          </p>
          <nav aria-label="Разделы" className="mt-6 flex flex-wrap gap-2">
            {harnessTemplates.map((t) => (
              <a
                key={t.id}
                href={'#' + t.id}
                className={`rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-dim transition-colors hover:text-ink ${FOCUS}`}
              >
                #{t.id}
              </a>
            ))}
          </nav>
          <p className="mt-4 font-mono text-xs text-dim">{harnessLead.usageLine}</p>
        </div>
      </section>

      {/* Три шаблона — по секции-главе на каждый (id = якоря из hero) */}
      {harnessTemplates.map((t) => (
        <SectionShell key={t.id} n={t.n} label={t.label} id={t.id}>
          <h2 className="font-mono text-2xl font-semibold uppercase tracking-tight text-ink">
            {t.title}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-dim">{t.whenToUse}</p>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
            <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-dim">
              // {t.blockLabel}
            </span>
            <CopyButton text={t.template} />
          </div>
          <pre className="mt-2 overflow-x-auto rounded-md border border-line bg-bg p-3 font-mono text-xs leading-relaxed text-ink">
            {t.template}
          </pre>
          <div className="mt-6">
            <Card label="нюансы">
              <ul className="space-y-2">
                {t.nuances.map((note) => (
                  <li key={note} className="text-sm leading-relaxed text-dim">
                    {note}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </SectionShell>
      ))}
    </>
  );
}
