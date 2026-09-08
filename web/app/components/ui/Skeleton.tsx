// Skeleton (ТЗ §5.4): loading-состояния списков. rect — карточная заглушка,
// line — строчная.

export function Skeleton({
  variant = 'rect',
  className = '',
}: {
  variant?: 'rect' | 'line';
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-surface-2 ${variant === 'line' ? 'h-4 w-full' : 'h-24 w-full'} ${className}`}
    />
  );
}
