// Группы навигации — единый источник для Header (app/components/Nav.tsx) и Footer
// (app/components/Footer.tsx). 23 роута → 7 групп. Public-данные, без сервер-импортов.
export interface NavItem {
  href: string;
  label: string;
}

export const navGroups: Array<{ tag: string; items: NavItem[] }> = [
  {
    tag: 'core',
    items: [
      { href: '/', label: 'Главная' },
      { href: '/dashboard', label: 'Dashboard' },
      { href: '/showcase', label: 'Витрина' },
    ],
  },
  {
    tag: 'rag',
    items: [
      { href: '/rag', label: 'RAG' },
      { href: '/rag/chat', label: 'чат' },
      { href: '/rag/chats', label: 'каталог' },
      { href: '/rag/index', label: 'index' },
      { href: '/rag/index-tg', label: 'index-tg' },
    ],
  },
  {
    tag: 'chat',
    items: [{ href: '/chat', label: 'Chat' }],
  },
  {
    tag: 'tg',
    items: [
      { href: '/tg/top', label: 'топ' },
      { href: '/tg/collect', label: 'collect' },
      { href: '/telegram/publish', label: 'publish' },
    ],
  },
  {
    tag: 'blog',
    items: [
      { href: '/blog/news', label: 'новости' },
      { href: '/blog/posts', label: 'посты' },
      { href: '/blog/pipeline', label: 'pipeline' },
      { href: '/blog/scout', label: 'scout' },
    ],
  },
  {
    tag: 'mcp',
    items: [
      { href: '/mcp/tools', label: 'tools' },
      { href: '/mcp/call', label: 'call' },
      { href: '/mcp/todos', label: 'todos' },
    ],
  },
  {
    tag: 'sys',
    items: [
      { href: '/agent', label: 'агент' },
      { href: '/briefing', label: 'сводка' },
      { href: '/summary', label: 'summary' },
      { href: '/admin/servers', label: 'серверы' },
      { href: '/settings', label: 'настройки' },
    ],
  },
];
