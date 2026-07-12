// Mobile drawer-навигация (видна <lg). Переиспользует navGroups (единый источник с
// Sidebar.tsx). 'use client' — держит open-state; закрывается по клику на overlay И
// по переходу (usePathname). CSP-safe: inline-SVG + React onClick, без inline-JS и
// без внешних иконок.
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navGroups } from '../../data/nav';

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Закрытие при переходе (роут сменился → drawer схлопывается).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-label="Меню"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-[40px] w-10 items-center justify-center rounded-md text-dim transition-colors hover:text-ink"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <line x1="2.5" y1="5" x2="15.5" y2="5" />
          <line x1="2.5" y1="9" x2="15.5" y2="9" />
          <line x1="2.5" y1="13" x2="15.5" y2="13" />
        </svg>
      </button>
      {open && (
        <div className="fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-bg/80"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <aside className="absolute left-0 top-0 h-full w-64 overflow-y-auto border-r border-line bg-bg p-3">
            {navGroups.map((g) => {
              const hasActive = g.items.some(
                (it) => pathname === it.href || pathname.startsWith(it.href + '/'),
              );
              return (
                <details key={g.tag} open={hasActive} className="group mb-3">
                  <summary className="cursor-pointer select-none font-mono text-[11px] uppercase tracking-wider text-dim hover:text-ink">
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
                          className={`rounded-md px-2 py-1 text-sm transition-colors duration-150 ${
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
        </div>
      )}
    </div>
  );
}
