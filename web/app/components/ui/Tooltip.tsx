import { cloneElement, isValidElement, type ReactElement } from 'react';

// Tooltip (ТЗ §5.4): css-only (hover/focus-within), задержка показа 300ms.
// Для иконочных кнопок; не перехватывает события — pointer-events-none.

export function Tooltip({ label, children }: { label: string; children: ReactElement }) {
  const wrapped = isValidElement(children)
    ? cloneElement(children as ReactElement<{ 'aria-label'?: string }>, {
        'aria-label':
          (children.props as { 'aria-label'?: string })['aria-label'] ?? label,
      })
    : children;
  return (
    <span className="group/tt relative inline-flex">
      {wrapped}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-nav mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-sm border border-line-strong bg-bg px-2 py-1 font-mono text-[11px] text-ink opacity-0 shadow-pop transition-opacity duration-fast ease-system delay-300 group-hover/tt:opacity-100 group-focus-within/tt:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
