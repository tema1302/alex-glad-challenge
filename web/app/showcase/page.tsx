// Витрина возможностей (/showcase) — функциональная, НЕ хронология дней.
// Что умеет система на день 27 по модулям + схема архитектуры + стек.
// Контент — из web/data/showcase.ts (public, без секретов).
import { architectureLayers, capabilitySections, stack, webChokepoint } from '../../data/showcase';

export const metadata = {
  title: 'Витрина — Иди на факты глянь',
};

export default function ShowcasePage() {
  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-xl font-semibold">Витрина возможностей</h1>
        <p className="mt-1 max-w-3xl text-sm text-neutral-500">
          Что умеет система на день 27 — по модулям. Это функциональный обзор, а не
          хронология дней челленджа. Многие поверхности доступны сейчас только в
          CLI/REPL; web-обвязка разделов появится в следующих фазах (P1+).
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {capabilitySections.map((s) => (
          <div
            key={s.id}
            className="rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="flex items-baseline gap-2">
              <span aria-hidden>{s.icon}</span>
              <h2 className="text-lg font-semibold">{s.title}</h2>
            </div>
            <p className="mt-1 text-sm text-neutral-500">{s.summary}</p>
            <ul className="mt-3 space-y-2">
              {s.items.map((it) => (
                <li key={it.title} className="text-sm">
                  <span className="font-medium">{it.title}.</span>{' '}
                  <span className="text-neutral-500">{it.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section>
        <h2 className="text-lg font-semibold">Архитектура</h2>
        <p className="mt-1 text-sm text-neutral-500">Слои системы сверху вниз.</p>
        <div className="mt-4 space-y-3">
          {architectureLayers.map((layer, idx) => (
            <div key={layer.name}>
              <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
                <div className="border-b border-neutral-200 bg-neutral-100 px-4 py-2 dark:border-neutral-800 dark:bg-neutral-900">
                  <span className="text-sm font-semibold">
                    {idx + 1}. {layer.name}
                  </span>
                  <span className="ml-2 text-xs text-neutral-500">{layer.role}</span>
                </div>
                <div className="flex flex-wrap gap-2 px-4 py-3">
                  {layer.nodes.map((n) => (
                    <span
                      key={n}
                      className="rounded border border-neutral-200 px-2 py-1 text-xs dark:border-neutral-700"
                    >
                      {n}
                    </span>
                  ))}
                </div>
              </div>
              {idx < architectureLayers.length - 1 ? (
                <div className="py-1 text-center text-neutral-400" aria-hidden>
                  ↓
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Web как поверхность</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {webChokepoint.map((n) => (
            <div
              key={n.title}
              className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="text-sm font-semibold">{n.title}</div>
              <p className="mt-1 text-sm text-neutral-500">{n.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Стек</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {stack.map((g) => (
            <div
              key={g.name}
              className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{g.name}</div>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {g.items.map((it) => (
                  <li
                    key={it}
                    className="rounded bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800"
                  >
                    {it}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
