// Mobile drawer-навигация (видна <lg). Переиспользует navGroups (единый источник с
// Sidebar.tsx). 'use client' — держит open-state; закрывается по клику на overlay И
// по переходу (usePathname). CSP-safe: inline-SVG + React onClick, без inline-JS и
// без внешних иконок.
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navGroups } from '../../data/nav';
import { IconSearch } from './ui/icons';
import { PALETTE_OPEN_EVENT } from './palette/CommandPalette';

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
        className="inline-flex min-h-[40px] w-10 items-center justify-center rounded-md text-dim transition-colors duration-fast hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <line x1="2.5" y1="5" x2="15.5" y2="5" />
          <line x1="2.5" y1="9" x2="15.5" y2="9" />
          <line x1="2.5" y1="13" x2="15.5" y2="13" />
        </svg>
      </button>
      {open && (
        // absolute (не fixed): header имеет backdrop-blur и создаёт containing block,
        // из-за чего fixed-drawer схлопывался до высоты шапки.
        <div className="absolute inset-x-0 top-full z-40 h-[calc(100dvh-3.5rem)]">
          <div
            className="absolute inset-0 bg-bg/80"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <aside className="absolute left-0 top-0 h-full w-[min(18rem,calc(100vw-3rem))] overflow-y-auto border-r border-line bg-bg p-3">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                window.dispatchEvent(new CustomEvent(PALETTE_OPEN_EVENT));
              }}
              className="mb-3 flex w-full items-center gap-2 rounded-md border border-line-strong px-2 py-2 text-sm text-dim transition-colors duration-fast hover:border-accent-dim hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim"
            >
              <IconSearch className="h-4 w-4 shrink-0" />
              Поиск по разделам
            </button>
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
        </div>
      )}
    </div>
  );
}
