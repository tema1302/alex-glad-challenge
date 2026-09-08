import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';

// Field (ТЗ §5.4): label + hint + error слот для Input/Textarea/Select.
// Все формы — через Field; связь label↔контрол и aria-describedby/aria-invalid
// прокидываются в единственный child автоматически (cloneElement).

// Канонический класс инпута (П-1): единая точка правды для страниц, где
// <Field> пока не применён (замена локальных INPUT/RUN_INPUT-констант).
export const INPUT_CLASS =
  'rounded border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink placeholder:text-dim disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent';

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
  // При ошибке hint не рендерится — в aria-describedby уходит только error-id
  // (ссылка на несуществующий элемент недопустима для скринридеров).
  const describedBy = error
    ? `${id}-error`
    : ([hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined);

  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>, {
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })
    : children;

  return (
    <div className={`space-y-1.5 ${className}`}>
      <label htmlFor={id} className="block font-sans text-xs font-medium text-dim">
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
