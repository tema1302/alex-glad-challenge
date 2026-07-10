// Навигация (server component). Активные роуты — ссылки; будущие фазы — явно
// помеченные placeholder'ы («скоро»), а не фейк-функционал.
import Link from 'next/link';
import { ThemeToggle } from './ThemeToggle';

const active = [
  { href: '/', label: 'Dashboard' },
  { href: '/showcase', label: 'Витрина' },
  { href: '/rag', label: 'RAG' },
  { href: '/rag/chat', label: 'RAG-чат' },
  { href: '/rag/chats', label: 'Каталог' },
  { href: '/rag/index', label: 'RAG index' },
  { href: '/rag/index-tg', label: 'RAG index-tg' },
  { href: '/chat', label: 'Chat' },
  { href: '/tg/top', label: 'TG-топ' },
  { href: '/tg/collect', label: 'TG collect' },
  { href: '/telegram/publish', label: 'TG publish' },
  { href: '/briefing', label: 'Сводка' },
  { href: '/mcp/todos', label: 'Todos' },
  { href: '/blog/news', label: 'Блог' },
  { href: '/blog/posts', label: 'Посты' },
  { href: '/blog/pipeline', label: 'Pipeline' },
  { href: '/blog/scout', label: 'Scout' },
  { href: '/mcp/tools', label: 'MCP tools' },
  { href: '/mcp/call', label: 'MCP call' },
  { href: '/agent', label: 'Агент' },
  { href: '/summary', label: 'Summary' },
  { href: '/admin/servers', label: 'Серверы' },
  { href: '/settings', label: 'Настройки' },
];

const soon: Array<{ href: string; label: string }> = [];

export default function Nav() {
  return (
    <header className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <Link href="/" className="text-base font-semibold tracking-tight">
        Иди на факты глянь
      </Link>
      <nav className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {active.map((i) => (
          <Link key={i.href} href={i.href} className="text-accent hover:underline">
            {i.label}
          </Link>
        ))}
        {soon.map((i) => (
          <span
            key={i.href}
            className="cursor-not-allowed text-neutral-400 dark:text-neutral-600"
            title="Раздел в разработке (P1+)"
          >
            {i.label}
            <span className="ml-0.5 text-[10px] uppercase">(скоро)</span>
          </span>
        ))}
      </nav>
      <div className="ml-auto">
        <ThemeToggle />
      </div>
    </header>
  );
}
