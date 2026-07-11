import Link from 'next/link';
import { navGroups } from '../../data/nav';

export default function Footer() {
  const flat = navGroups.flatMap((g) => g.items);
  return (
    <footer className="mt-auto border-t border-line px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-dim">
        {flat.map((it) => (
          <Link key={it.href} href={it.href} className="transition-colors duration-150 hover:text-ink">
            {it.label}
          </Link>
        ))}
      </div>
    </footer>
  );
}
