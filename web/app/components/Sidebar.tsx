'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navGroups } from '../../data/nav';

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-56 shrink-0 overflow-y-auto border-r border-line px-3 py-4 lg:block">
      {navGroups.map((g) => {
        const hasActive = g.items.some(
          (it) => pathname === it.href || pathname.startsWith(it.href + '/'),
        );
        const Icon = g.icon;
        return (
          <details key={g.tag} open={hasActive} className="group mb-3">
            <summary className="flex cursor-pointer select-none items-center gap-2 font-sans text-xs font-semibold text-dim hover:text-ink">
              {Icon ? <Icon className="shrink-0" /> : null}
              {g.tag}
            </summary>
            <div className="mt-1 flex flex-col">
              {g.items.map((it) => {
                const active =
                  pathname === it.href || pathname.startsWith(it.href + '/');
                return (
                  <Link
                    key={it.href}
                    href={it.href}
                    aria-current={active ? 'page' : undefined}
                    className={`rounded-md px-2 py-1 text-sm transition-colors duration-fast ease-system focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim ${
                      active
                        ? 'active-link'
                        : 'text-dim hover:bg-surface-2 hover:text-ink'
                    }`}
                  >
                    {it.label}
                  </Link>
                );
              })}
            </div>
          </details>
        );
      })}
    </aside>
  );
}
