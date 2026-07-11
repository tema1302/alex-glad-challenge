// Контент лендинга Артемия (главная /). Public, без секретов, без NEXT_PUBLIC_*.
// Curated-дубликат фактов challenge (база — data/showcase.ts + registry.ts), без импорта:
// лендинг — server component без тяги в lib/server или @challenge/core.
// Классы Tailwind намеренно полные-литералы (для JIT-детекта) лежат в app/page.tsx,
// здесь — только данные.

export type Tag = 'AI' | 'TG' | 'RSS' | 'MCP' | 'Web' | 'DB';
export type Accent = 'green' | 'cyan' | 'magenta';

export interface HeroStat {
  value: string;
  label: string;
}

export interface Hero {
  name: string;
  role: string;
  tagline: string;
  stats: HeroStat[];
}

export interface LandingFeature {
  id: string;
  icon: string;
  title: string;
  summary: string;
  tags: Tag[];
  href?: string;
  accent: Accent;
}

export const hero: Hero = {
  name: 'АРТЕМИЙ',
  role: 'AI-инженер',
  tagline: 'локальные LLM-агенты, RAG, TG-автоматизация',
  stats: [
    { value: '30', label: 'дней челленджа' },
    { value: '23', label: 'раздела' },
    { value: '6', label: 'модулей' },
    { value: '100%', label: 'локально' },
  ],
};

export const skills: string[] = [
  'TypeScript',
  'Node.js',
  'Next.js',
  'React',
  'RAG',
  'Ollama',
  'MTProto',
  'MCP',
  'SQLite',
  'Tailwind',
];

export const landingFeatures: LandingFeature[] = [
  {
    id: 'local-llm',
    icon: '🤖',
    title: 'Локальная LLM',
    summary: 'Ollama (qwen3.5) — приватный AI без облака. RAG и чат работают офлайн на 127.0.0.1, ноль ключей наружу.',
    tags: ['AI'],
    href: '/showcase',
    accent: 'green',
  },
  {
    id: 'rag-chat',
    icon: '🔎',
    title: 'RAG-чат',
    summary: 'Поиск по базе знаний с цитатами [n], rerank и guard «не знаю». Стратегии fixed / structure / telegram, сессии и алиасы.',
    tags: ['AI', 'DB'],
    href: '/rag/chat',
    accent: 'cyan',
  },
  {
    id: 'chat-agent',
    icon: '🧠',
    title: 'Chat-агент с ветвлением',
    summary: 'Дерево веток диалога, 3 слоя памяти (long / short / working), профили пользователя и явные ограничения.',
    tags: ['AI'],
    href: '/chat',
    accent: 'magenta',
  },
  {
    id: 'tg-mtproto',
    icon: '✈️',
    title: 'TG MTProto userbot',
    summary: 'Userbot-сессия собирает forum-топики: сообщения, авторы, реакции. Индексация прямо в RAG-партицию.',
    tags: ['TG'],
    href: '/tg/top',
    accent: 'cyan',
  },
  {
    id: 'rss-blog',
    icon: '📰',
    title: 'RSS → блог pipeline',
    summary: 'Новости (sports.ru, championat, bbc) → пост в стиле канала. FSM: plan → execute → validate → revise.',
    tags: ['RSS'],
    href: '/blog/pipeline',
    accent: 'green',
  },
  {
    id: 'mcp',
    icon: '🔌',
    title: 'MCP-серверы',
    summary: 'Свои HTTP/stdio MCP: todos, summary, proxy к удалённым серверам. Agent-loop и оркестратор инструментов.',
    tags: ['MCP'],
    href: '/mcp/tools',
    accent: 'magenta',
  },
  {
    id: 'web-dashboard',
    icon: '🖥️',
    title: 'Web-dashboard',
    summary: 'Локальный Next.js: live-счётчики БД, статус ключей без значений, стриминг LLM и debug-таблицы.',
    tags: ['Web', 'DB'],
    href: '/dashboard',
    accent: 'cyan',
  },
  {
    id: 'memory',
    icon: '💾',
    title: 'Memory 3 слоя',
    summary: 'long-term факты + short-term окно + working task-state. Персистентно в SQLite через node:sqlite (WAL).',
    tags: ['DB'],
    href: '/chat',
    accent: 'green',
  },
  {
    id: 'todo-summary',
    icon: '✅',
    title: 'Todo & Summary',
    summary: 'MCP-задачи и ежедневная сводка в Telegram. Естественный язык → структурированные туду без облака.',
    tags: ['MCP'],
    href: '/summary',
    accent: 'magenta',
  },
  {
    id: 'embeddings',
    icon: '🧬',
    title: 'Embeddings & rerank',
    summary: 'Brute-force cosine по эмбеддингам Ollama + rerank. Guard от галлюцинаций при пустом или слабом индексе.',
    tags: ['AI', 'DB'],
    href: '/rag',
    accent: 'cyan',
  },
];
