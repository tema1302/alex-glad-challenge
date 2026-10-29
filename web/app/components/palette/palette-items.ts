// Данные командной палитры (⌘K): одинаковые публичные пункты для всех, полный
// каталог navGroups — только админу. Клиент-safe: data/nav и data/landing не
// тянут серверных импортов. Гость не видит даже существования защищённых
// маршрутов — анти-утечка IA, как в Nav/Sidebar.
import { navGroups } from '../../../data/nav';
import { channel } from '../../../data/landing';

export interface PaletteItem {
  id: string;
  label: string;
  /** Подзаголовок в списке: группа навигации или пометка «публичное». */
  hint?: string;
  href: string;
  /** Внешняя ссылка (канал) — открывается в новой вкладке, не через router. */
  external?: boolean;
}

/** Публичные пункты — доступны и гостю, и админу (дубли по href убираются ниже). */
const GUEST_ITEMS: readonly PaletteItem[] = [
  { id: 'home', label: 'Главная', hint: 'публичное', href: '/' },
  { id: 'demo', label: 'Спросить базу знаний', hint: 'публичное · RAG-демо', href: '/demo' },
  { id: 'harness', label: 'Тренажёр конвейера', hint: 'публичное', href: '/harness' },
  { id: 'pipeline', label: 'Конвейер блог-агентов', hint: 'публичное', href: '/blog/pipeline' },
  { id: 'jira', label: 'Генератор задач', hint: 'публичное', href: '/jira' },
  { id: 'login', label: 'Войти', hint: 'админка', href: '/login' },
  {
    id: 'channel',
    label: `Телеграм-канал ${channel.handle}`,
    hint: 'внешняя ссылка',
    href: channel.url,
    external: true,
  },
];

/** Команды палитры: админ получает весь каталог, гость — только публичное. */
export function buildPaletteItems(isAdmin: boolean): PaletteItem[] {
  if (!isAdmin) return [...GUEST_ITEMS];
  const admin = navGroups.flatMap((g) =>
    g.items.map((it) => ({ id: it.href, label: it.label, hint: g.tag, href: it.href })),
  );
  const seen = new Set(admin.map((i) => i.href));
  return [...admin, ...GUEST_ITEMS.filter((i) => !seen.has(i.href))];
}
