// Контент личного продающего лендинга v2 (/, landing-v2). Public, без секретов, без NEXT_PUBLIC_*.
// Единый источник: правки оффера/имени/канала/метрик — здесь, без трогания верстки.
// Curated-дубликат фактов challenge (registry.ts, CHANGELOG, git log), без импорта:
// лендинг — server component без тяги в lib/server или @challenge/core.
// Tailwind-классы намеренно полные-литералы (JIT-детект) — в app/page.tsx, здесь только данные.
// Числа — завершённый срез челленджа: 36/10+/7/82.

/** Id иконки из app/components/ui/icons.tsx (8 существующих, включая telegram). */
export type LandingIconId =
  | 'database'
  | 'sparkles'
  | 'plug'
  | 'send'
  | 'rss'
  | 'messages'
  | 'cpu'
  | 'telegram';

// --- S1. Hero: оффер (варианты A/B/C — выбор за пользователем, допустим микс) ---

export const offerVariants = {
  A: {
    // «инженерная кухня AI» — базовая рекомендация критика (ВЫБРАНО)
    headline: 'Строю AI-системы — и показываю, как они устроены внутри',
    subhead:
      'В канале — разборы реальных подсистем: RAG на локальных моделях, свои MCP-серверы, ' +
      'Telegram-автоматизация. Не пересказ новостей, а работающий код: что сделал, что сломалось и почему.',
  },
  B: {
    // «локальный AI без облака и магии» — утилитарный
    headline: 'Локальный AI без облака и без магии',
    subhead:
      'Ollama на ноутбуке, свой RAG, MCP-инструменты — связки, которые работают без дорогих API. ' +
      'Показываю схемы и грабли, на которые наступил. 36 дней такого уже построено.',
  },
  C: {
    // «челлендж-нарратив» — личная история
    headline: '36 дней подряд я собирал AI-стэк с нуля',
    subhead:
      'Каждый день — новая подсистема: RAG-движок, MCP-серверы, TG-userbot, web-дашборд. ' +
      'Теперь разбираю это в канале: как устроено, что не взлетело, что пошло в бой.',
  },
} as const;

/** Активный оффер — свитч одной строкой (offerVariants.A / .B / .C или микс полей). */
export const offer = offerVariants.A;

/** Description для page-local metadata `/` (тон подписки, число 36). */
export const offerMeta = {
  metaDescription:
    'AI-инженер Артемий Артель. 36 дней подряд строил по AI-системе в день — RAG, MCP, ' +
    'Telegram-автоматизация. В канале разбираю, как это устроено: что сделал, что сломалось, почему.',
};

// --- Личность (имя — подстрока hero-лейбла + metadata) ---

export const person = {
  name: 'Артемий Артель',
  role: 'AI-инженер',
};

// --- Конверсия: канал (ссылка на КАНАЛ) ---

export const channel = {
  url: 'https://t.me/artemiyartel',
  handle: '@artemiyartel',
  subscribeLabel: 'Подписаться на канал',
};

// --- S2. Proof ---

export const challengeNarrative =
  '36 дней подряд я собирал по одной AI-подсистеме в день: поиск по своим текстам, ' +
  'tool-серверы для LLM-агентов, Telegram-userbot, web-дашборд. Всё в одном репо и проходит ' +
  'строгий typecheck — показываю и то, что вышло, и то, что сломалось. ' +
  'Работающий стэк вместо списка технологий.';

export const proofMetrics = {
  dominant: { value: '36', label: 'дней подряд' },
  rest: [
    { value: '10+', label: 'подсистем с нуля' },
    { value: '7', label: 'MCP-серверов' },
    { value: '82', label: 'коммита в main' },
  ],
} as const;

export const milestones = [
  {
    days: '18–20',
    title: 'MCP + Telegram',
    desc: 'Свои tool-серверы, напоминания, ежедневные сводки.',
  },
  {
    days: '21–25',
    title: 'RAG и память',
    desc: 'Поиск по своим текстам с guard «не знаю» + 3 слоя памяти диалога.',
  },
  {
    days: '28–30',
    title: 'Web-дашборд',
    desc: 'Next.js 15, 23 раздела, приватный LLM-gateway.',
  },
  {
    days: '31–36',
    title: 'Агенты и этот лендинг',
    desc: 'dev-assistant, PR-ревью, файловый агент — и страница, которую читаете.',
  },
] as const;

// --- S3. Артефакты (products+core слиты; href — live-маршрут, кликабелен только админ) ---

export const artifacts = [
  {
    tag: 'RAG',
    title: 'RAG-движок',
    desc: 'Поиск по своим документам и чатам: локальные эмбеддинги, rerank, цитаты источников. Честно отвечает «не знаю».',
    href: '/rag/chat',
    icon: 'database',
  },
  {
    tag: 'MCP',
    title: 'MCP-серверы',
    desc: '7 своих tool-серверов для LLM-агентов — от CRM до файлов. Детерминированные, без «магических» циклов.',
    href: '/mcp/tools',
    icon: 'plug',
  },
  {
    tag: 'LLM',
    title: 'LLM-gateway',
    desc: 'Один вход к трём провайдерам: локальная Ollama, DeepSeek, OpenRouter. Переключение без переписывания приложений.',
    href: '/settings',
    icon: 'cpu',
  },
  {
    tag: 'Telegram',
    title: 'TG-userbot + RSS',
    desc: 'Читает топики форумов, собирает RSS, шлёт ежедневные дайджесты. Работает без ручного вмешательства.',
    href: '/tg/top',
    icon: 'send',
  },
  {
    tag: 'Память',
    title: 'Память диалога',
    desc: '3 слоя памяти, ветвление, кросс-чат контекст — бот помнит, о чём говорили вчера.',
    href: '/chat',
    icon: 'messages',
  },
  {
    tag: 'Web',
    title: 'Web-дашборд',
    desc: 'Next.js 15 + React 19: 23 раздела над всей системой. Этот лендинг — тоже часть него.',
    href: '/dashboard',
    icon: 'cpu',
  },
] as const satisfies ReadonlyArray<{
  tag: string;
  title: string;
  desc: string;
  href?: string;
  icon: LandingIconId;
}>;

export const stackLine =
  'TypeScript strict · Node.js 24 · Next.js 15 · React 19 · node:sqlite · Ollama / DeepSeek / OpenRouter · gramjs';

// --- S4. Финальный CTA (ПЛЕЙСХОЛДЕР — редакционная формула от пользователя) ---

export const channelPoints = [
  'Как устроены подсистемы челленджа: RAG, MCP-серверы, память, gateway',
  'Что не взлетело и почему: тупики, переделки, цена локальных моделей',
  'Цифры и затраты: сколько реально стоит локальный LLM-стэк',
];

// --- Контакты вне канала (github убран: репо приватный → 404 для гостя) ---

export const contactLinks = [
  { label: 'email', value: 'temi4.1302@gmail.com', href: 'mailto:temi4.1302@gmail.com' },
] as const;
