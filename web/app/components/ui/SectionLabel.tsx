// Eyebrow-лейбл секции: Manrope caps (единственный разрешённый uppercase у текста —
// служебный eyebrow, не данные). Без `//`-префикса; aria-level — контракт e2e.
export function SectionLabel({ children }: { children: string }) {
  return (
    <div role="heading" aria-level={2} className="mb-3 font-sans text-xs font-semibold uppercase tracking-wider text-dim">
      {children}
    </div>
  );
}
