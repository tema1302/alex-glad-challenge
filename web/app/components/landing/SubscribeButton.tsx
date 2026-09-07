// SubscribeButton — единственная реализация конверсионного действия лендинга.
// v3 «Paper × Aurora»: primary — aurora-градиентная pill-кнопка (сдвиг градиента
// при hover); inline — брендовая mono-ссылка для середины скролла.
// Все CTA страницы — только через этот компонент.
import { IconTelegram } from '../ui/icons';

interface SubscribeButtonProps {
  href: string;
  label: string;
  variant?: 'primary' | 'inline';
  className?: string;
}

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-paper';

export function SubscribeButton({ href, label, variant = 'primary', className = '' }: SubscribeButtonProps) {
  if (variant === 'inline') {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex min-h-[44px] items-center gap-1.5 font-mono text-sm font-semibold text-brand-600 transition-colors duration-fast hover:text-brand-700 ${FOCUS} ${className}`}
      >
        {`→ ${label}`}
      </a>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex min-h-[52px] whitespace-nowrap items-center justify-center gap-2 rounded-full bg-[linear-gradient(100deg,#5A4BFF_0%,#9333EA_50%,#14B8A6_100%)] bg-[length:150%_150%] bg-left px-8 text-base font-bold text-white shadow-lift transition-all duration-base ease-system hover:-translate-y-0.5 hover:bg-right ${FOCUS} ${className}`}
    >
      <IconTelegram className="h-4 w-4" />
      {label}
    </a>
  );
}
