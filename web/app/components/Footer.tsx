import Link from 'next/link';
import { navGroups } from '../../data/nav';

const PRIMARY = new Set(['/', '/dashboard', '/showcase', '/rag', '/blog/scout', '/settings']);

export default function Footer() {
  const flat = navGroups.flatMap((g) => g.items);
  const primary = flat.filter((it) => PRIMARY.has(it.href));
  const linkClass = 'transition-colors duration-150 hover:text-ink';
  return (
    <footer className="mt-auto border-t border-line px-4 py-4 sm:px-5 sm:py-3">
      {/* Мобильный подвал: 6 ключевых ссылок + раскрывающийся полный список.
          Плоские ~55 ссылок подряд на телефоне превращались в стену текста. */}
      <nav aria-label="Основные ссылки" className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-dim sm:hidden">
        {primary.map((it) => (
          <Link key={it.href} href={it.href} className={linkClass}>
            {it.label}
          </Link>
        ))}
      </nav>
      <details className="mt-2 sm:hidden">
        <summary className="cursor-pointer select-none font-mono text-[11px] text-dim hover:text-ink">
          все разделы · {flat.length}
        </summary>
        <nav aria-label="Все разделы" className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px] text-dim">
          {flat.map((it) => (
            <Link key={it.href} href={it.href} className={linkClass}>
              {it.label}
            </Link>
          ))}
        </nav>
      </details>
      <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-dim sm:flex">
        {flat.map((it) => (
          <Link key={it.href} href={it.href} className={linkClass}>
            {it.label}
          </Link>
        ))}
      </div>
    </footer>
  );
}
