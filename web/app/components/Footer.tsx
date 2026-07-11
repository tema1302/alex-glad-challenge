// Footer (server component). Зеркалит Header: те же группы навигации (data/nav.ts),
// плюс копирайт. Hairline border-top, без glow/неона.
import Link from 'next/link';
import { navGroups } from '../../data/nav';

export default function Footer() {
  return (
    <footer className="mt-16 border-t border-neutral-800 pt-6 text-sm">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Link href="/" className="font-semibold tracking-tight text-neutral-100">
          Артемий · AI
        </Link>
        <nav className="flex flex-wrap gap-x-4 gap-y-2">
          {navGroups.map((g) => (
            <span key={g.tag} className="flex items-center gap-x-2">
              <span className="text-[10px] uppercase tracking-[0.2em] text-neutral-600">{g.tag}</span>
              {g.items.map((i) => (
                <Link key={i.href} href={i.href} className="text-neutral-500 transition-colors hover:text-accent">
                  {i.label}
                </Link>
              ))}
            </span>
          ))}
        </nav>
      </div>
      <div className="mt-4 text-xs text-neutral-600">
        © Артемий · локальный Next.js на 127.0.0.1 · LLM / RAG / MTProto / MCP
      </div>
    </footer>
  );
}
