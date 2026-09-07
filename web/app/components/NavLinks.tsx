// Core-ссылки верхней панели (клиентская часть Nav): активный пункт —
// aria-current="page" + визуальное выделение (ТЗ §8.7). Вынесено из server-Nav,
// т.к. активность требует usePathname.
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navGroups } from '../../data/nav';

const core = navGroups.find((g) => g.tag === 'core') ?? navGroups[0];

export function NavCoreLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Основные разделы" className="hidden items-center gap-1 sm:flex">
      {core.items.map((it) => {
        const active = pathname === it.href;
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? 'page' : undefined}
            className={`rounded-md px-2 py-1 text-sm transition-colors duration-fast ease-system focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim ${
              active ? 'bg-surface-2 text-accent' : 'text-dim hover:text-ink'
            }`}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
