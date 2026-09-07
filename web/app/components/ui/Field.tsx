import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';

// Field (ТЗ §5.4): label + hint + error слот для Input/Textarea/Select.
// Все формы — через Field; связь label↔контрол и aria-describedby/aria-invalid
// прокидываются в единственный child автоматически (cloneElement).

export function Field({
  id,
  label,
  hint,
  error,
  children,
  className = '',
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactElement;
  className?: string;
}) {
  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;

  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>, {
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })
    : children;

  return (
    <div className={`space-y-1.5 ${className}`}>
      <label htmlFor={id} className="block font-mono text-xs uppercase tracking-wider text-dim">
        {label}
      </label>
      {control}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs leading-relaxed text-dim">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs leading-relaxed text-err">
          {error}
        </p>
      ) : null}
    </div>
  );
}
