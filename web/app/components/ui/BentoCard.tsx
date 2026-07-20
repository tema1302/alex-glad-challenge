// BentoCard — stateless Server Component.
// Tile = одна navigation-цель (вся плитка кликабельна через <Link>).
// Hover: bg/border-shift, 0 transform (layout-shift антипаттерн).
import Link from 'next/link';
import { type CSSProperties, type ReactNode } from 'react';

interface BentoCardProps {
  href: string;
  icon: ReactNode;
  badge: string;
  title: string;
  desc: string;
  index: number;
  ariaLabel?: string;
  className?: string;
}

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

export function BentoCard({
  href,
  icon,
  badge,
  title,
  desc,
  index,
  ariaLabel,
  className = '',
}: BentoCardProps) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel ?? `Открыть ${title}`}
      style={{ '--i': String(index) } as CSSProperties}
      className={`bento-enter group flex flex-col justify-between rounded-2xl border border-line bg-surface p-6 transition-colors duration-200 hover:border-line-strong hover:bg-surface-2 ${FOCUS} ${className}`}
    >
      <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-accent">
        {icon}
        <span>{badge}</span>
      </div>
      <div className="mt-5">
        <h3 className="font-sans text-lg font-semibold text-ink">{title}</h3>
        <p className="mt-2 font-sans text-sm leading-relaxed text-dim">{desc}</p>
      </div>
      <div className="mt-4 font-mono text-xs text-dim transition-colors group-hover:text-accent">→</div>
    </Link>
  );
}
