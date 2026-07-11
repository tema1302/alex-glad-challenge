// Витрина возможностей (/showcase) — функциональная, НЕ хронология дней.
// Что умеет система на день 27 по модулям + схема архитектуры + стек.
// Контент — из web/data/showcase.ts (public, без секретов).
//
// Редизайн C (день 30): read-only архетип — capability → <Card label> сетка,
// architecture-layers → нумерованный список mono-labels.
import { architectureLayers, capabilitySections, stack, webChokepoint } from '../../data/showcase';
import { Card } from '../components/ui/Card';
import { SectionLabel } from '../components/ui/SectionLabel';

export const metadata = {
  title: 'Витрина — Иди на факты глянь',
};

export default function ShowcasePage() {
  return (
    <div className="space-y-10">
      <section>
        <SectionLabel>showcase · v30</SectionLabel>
        <h1 className="font-mono text-2xl font-semibold uppercase tracking-tight text-ink">Витрина возможностей</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-dim">
          Что умеет система на день 27 — по модулям. Это функциональный обзор, а не
          хронология дней челленджа. Многие поверхности доступны сейчас только в
          CLI/REPL; web-обвязка разделов появится в следующих фазах (P1+).
        </p>
      </section>

      <section>
        <SectionLabel>возможности</SectionLabel>
        <div className="grid gap-4 md:grid-cols-2">
          {capabilitySections.map((s) => (
            <Card key={s.id} label={s.title}>
              <div className="flex items-baseline gap-2">
                <span aria-hidden>{s.icon}</span>
                <p className="text-sm text-dim">{s.summary}</p>
              </div>
              <ul className="mt-3 space-y-2">
                {s.items.map((it) => (
                  <li key={it.title} className="text-sm">
                    <span className="font-medium text-ink">{it.title}.</span>{' '}
                    <span className="text-dim">{it.detail}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <SectionLabel>архитектура · слои</SectionLabel>
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
        <SectionLabel>web как поверхность</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-2">
          {webChokepoint.map((n) => (
            <Card key={n.title} label={n.title}>
              <p className="text-sm text-dim">{n.detail}</p>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <SectionLabel>стек</SectionLabel>
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
