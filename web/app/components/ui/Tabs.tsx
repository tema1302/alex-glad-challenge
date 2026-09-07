'use client';

// Tabs (ТЗ §5.4): строковые табы (превью компоузера: Рендер | HTML).
// ARIA-роли tablist/tab; активный таб — surface-2 + accent-маркер.

export interface TabItem {
  id: string;
  label: string;
}

export function Tabs({
  tabs,
  active,
  onChange,
  label,
}: {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="inline-flex gap-1 rounded-md border border-line bg-surface p-1"
    >
      {tabs.map((t) => {
        const selected = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(t.id)}
            className={`rounded-sm px-3 py-1 font-mono text-xs uppercase tracking-wide transition-colors duration-fast ease-system focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim ${
              selected ? 'bg-surface-2 text-accent' : 'text-dim hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
