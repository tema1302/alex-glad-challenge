// SubscribeButton — единственная реализация конверсионного действия лендинга (landing-v2).
// primary: внешний <a> (t.me) target=_blank rel="noopener noreferrer" — accent-кнопка
// min-h-[44px] + IconTelegram + focus-ring. inline: mono teal-ссылка «→ {label}»
// (inline-CTA в середине скролла). Все CTA страницы — только через этот компонент.
import { IconTelegram } from '../ui/icons';

interface SubscribeButtonProps {
  href: string;
  label: string;
  variant?: 'primary' | 'inline';
}

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

export function SubscribeButton({ href, label, variant = 'primary' }: SubscribeButtonProps) {
  if (variant === 'inline') {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex min-h-[40px] items-center font-mono text-sm text-accent transition-colors hover:text-ink ${FOCUS}`}
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
      className={`inline-flex min-h-[44px] items-center gap-2 rounded-md bg-accent px-6 text-sm font-semibold text-accent-ink transition-filter hover:brightness-110 ${FOCUS}`}
    >
      <IconTelegram />
      {label}
    </a>
  );
}
