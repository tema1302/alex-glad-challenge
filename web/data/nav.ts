// Группы навигации — единый источник для Header (app/components/Nav.tsx) и Footer
// (app/components/Footer.tsx). 23 роута → 7 групп. Public-данные, без сервер-импортов.
import type { ComponentType } from 'react';
import {
  IconCpu,
  IconDatabase,
  IconMessages,
  IconPlug,
  IconRss,
  IconSparkles,
  IconTelegram,
} from '../app/components/ui/icons';

export interface NavItem {
  href: string;
  label: string;
}

// icon — глиф группы для Sidebar/MobileNav (опционален; href/label/tag — контракт).
export const navGroups: Array<{
  tag: string;
  icon?: ComponentType<{ className?: string }>;
  items: NavItem[];
}> = [
  {
    tag: 'core',
    icon: IconSparkles,
    items: [
      { href: '/', label: 'Главная' },
      { href: '/dashboard', label: 'Dashboard' },
      { href: '/showcase', label: 'Витрина' },
    ],
  },
  {
    tag: 'rag',
    icon: IconDatabase,
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
    icon: IconMessages,
    items: [
      { href: '/chat', label: 'Chat' },
      { href: '/joker', label: 'Шутник' },
    ],
  },
  {
    tag: 'tg',
    icon: IconTelegram,
    items: [
      { href: '/tg/top', label: 'топ' },
      { href: '/tg/collect', label: 'collect' },
      { href: '/telegram/publish', label: 'TG-постинг' },
    ],
  },
  {
    tag: 'blog',
    icon: IconRss,
    items: [
      { href: '/blog/news', label: 'новости' },
      { href: '/blog/posts', label: 'посты' },
      { href: '/blog/pipeline', label: 'pipeline' },
      { href: '/blog/scout', label: 'scout' },
    ],
  },
  {
    tag: 'mcp',
    icon: IconPlug,
    items: [
      { href: '/mcp/tools', label: 'tools' },
      { href: '/mcp/call', label: 'call' },
      { href: '/mcp/todos', label: 'todos' },
    ],
  },
  {
    tag: 'sys',
    icon: IconCpu,
    items: [
      { href: '/agent', label: 'агент' },
      { href: '/briefing', label: 'сводка' },
      { href: '/summary', label: 'summary' },
      { href: '/admin/servers', label: 'серверы' },
      { href: '/settings', label: 'настройки' },
    ],
  },
];
