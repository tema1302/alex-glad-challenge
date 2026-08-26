// Контент личного продающего лендинга v2 (/, landing-v2). Public, без секретов, без NEXT_PUBLIC_*.
// Единый источник: правки оффера/имени/канала/метрик — здесь, без трогания верстки.
// Curated-дубликат фактов challenge (registry.ts, CHANGELOG, git log), без импорта:
// лендинг — server component без тяги в lib/server или @challenge/core.
// Tailwind-классы намеренно полные-литералы (JIT-детект) — в app/page.tsx, здесь только данные.
// Числа в метриках — объёмы системы (артефакты/подсистемы/MCP/коммиты); длительность
// челленджа в рендеримых текстах не упоминается.

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
      'Показываю схемы и грабли, на которые наступил. Стэк уже собран и работает.',
  },
  C: {
    // «челлендж-нарратив» — личная история
    headline: 'Я собирал AI-стэк с нуля — подсистема за подсистемой',
    subhead:
      'Каждый день — новая подсистема: RAG-движок, MCP-серверы, TG-userbot, web-дашборд. ' +
      'Теперь разбираю это в канале: как устроено, что не взлетело, что пошло в бой.',
  },
} as const;

/** Активный оффер — свитч одной строкой (offerVariants.A / .B / .C или микс полей). */
export const offer = offerVariants.A;

/** Description для page-local metadata `/` (тон подписки, без упоминания длительности). */
export const offerMeta = {
  metaDescription:
    'AI-инженер Артемия Артель. Собрал рабочий стэк AI-агентов — RAG, MCP-серверы, ' +
    'Telegram-автоматизация. В канале разбираю, как это устроено: что сделал, что сломалось, почему.',
};

// --- Личность (имя — подстрока hero-лейбла + metadata) ---

export const person = {
  name: 'Артемия Артель',
  role: 'AI-инженер',
};

// --- Конверсия: канал (ссылка на КАНАЛ) ---

export const channel = {
  url: 'https://t.me/artemiyartel',
  handle: '@artemiyartel',
  subscribeLabel: 'Подписаться на канал',
};

// --- Сетка артефактов (S3) — объявлена до Proof: её длина = доминанта Proof-секции ---

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

// --- Ряд «можно попробовать» (S3, над витриной): публичные интерактивы, ссылки
// активны у обеих ролей — гость тоже тыкает. В отличие от артефактов-доказательств,
// где href только админу (анти-утечка админских маршрутов). ---

export const tryItems = [
  {
    tag: 'JIRA',
    title: 'Задача в Jira за минуту',
    desc: 'Опишите фичу парой предложений — ИИ-тимлид развернёт её в полную постановку: сценарий, критерии приемки, ожидаемый результат. Копируется в трекер одним кликом.',
    href: '/jira',
    icon: 'sparkles',
  },
  {
    tag: 'PIPELINE',
    title: 'Конвейер агентов: новость → пост',
    desc: 'Живой автомат из четырёх агентов: выбор темы → черновик → фактчекинг → правка. Покликайте переходы FSM в демо-режиме — без логина.',
    href: '/blog/pipeline',
    icon: 'rss',
  },
  {
    tag: 'DOCS',
    title: 'Харнес-шаблоны для AI-ассистентов',
    desc: 'Три готовых шаблона инструкций (CLAUDE.md / AGENTS.md): контракт вызова, память, профили. Скопируйте и положите в свой проект.',
    href: '/harness',
    icon: 'messages',
  },
] as const satisfies ReadonlyArray<{
  tag: string;
  title: string;
  desc: string;
  href: string;
  icon: LandingIconId;
}>;

export const challengeNarrative =
  'Подсистема за подсистемой я собирал рабочий AI-стэк: поиск по своим текстам, ' +
  'tool-серверы для LLM-агентов, Telegram-userbot, web-дашборд. Всё в одном репо и проходит ' +
  'строгий typecheck — показываю и то, что вышло, и то, что сломалось. ' +
  'Работающий стэк вместо списка технологий.';

/** Доминанта Proof-секции = размер сетки артефактов (ниже), а не длительность. */
export const proofMetrics = {
  dominant: { value: String(artifacts.length), label: 'инструментов собрано и работает' },
  rest: [
    { value: '10+', label: 'подсистем с нуля' },
    { value: '7', label: 'MCP-серверов' },
    { value: '82', label: 'коммита в main' },
  ],
} as const;

export const milestones = [
  {
    phase: 'Интеграции',
    title: 'MCP + Telegram',
    desc: 'Свои tool-серверы, напоминания, ежедневные сводки.',
  },
  {
    phase: 'Поиск',
    title: 'RAG и память',
    desc: 'Поиск по своим текстам с guard «не знаю» + 3 слоя памяти диалога.',
  },
  {
    phase: 'Продукт',
    title: 'Web-дашборд',
    desc: 'Next.js 15, 23 раздела, приватный LLM-gateway.',
  },
  {
    phase: 'Автономность',
    title: 'Агенты и этот лендинг',
    desc: 'dev-assistant, PR-ревью, файловый агент — и страница, которую читаете.',
  },
] as const;

// --- S3. Артефакты (тексты сетки; сам массив объявлен выше — его длина питает доминанту Proof) ---

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
