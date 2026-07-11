// Header (server component). Persistent nav на всех страницах: brand + grouped links
// (data/nav.ts, единый источник с Footer). Hairline border-bottom, без glow/неона.
import Link from 'next/link';
import { ThemeToggle } from './ThemeToggle';
import { navGroups } from '../../data/nav';

export default function Nav() {
  return (
    <header className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-neutral-800 pb-4">
      <Link href="/" className="text-base font-semibold tracking-tight text-neutral-100">
        Артемий · AI
      </Link>
      <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {navGroups.map((g) => (
          <span key={g.tag} className="flex items-center gap-x-2">
            <span className="text-[10px] uppercase tracking-[0.2em] text-neutral-600">{g.tag}</span>
            {g.items.map((i) => (
              <Link
                key={i.href}
                href={i.href}
                className="text-neutral-400 transition-colors hover:text-accent"
              >
                {i.label}
              </Link>
            ))}
          </span>
        ))}
      </nav>
      <div className="ml-auto">
        <ThemeToggle />
      </div>
    </header>
  );
}
