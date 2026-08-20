// Контент личного продающего лендинга (/, день 36). Public, без секретов, без NEXT_PUBLIC_*.
// Единый источник: правки имени/контактов/метрик — здесь, без трогания верстки.
// Curated-дубликат фактов challenge (registry.ts, CHANGELOG, git log), без импорта:
// лендинг — server component без тяги в lib/server или @challenge/core.
// Tailwind-классы намеренно полные-литералы (JIT-детект) — в app/page.tsx, здесь только данные.
// Числа — ручной срез (дрейф 35 → 36+ правится здесь).

/** Id иконки из app/components/ui/icons.tsx (новых иконок не добавлять — 7 существующих). */
export type LandingIconId = 'database' | 'sparkles' | 'plug' | 'send' | 'rss' | 'messages' | 'cpu';

// --- S1. Hero (личность) ---

export const person = {
  /** Имя-плейсхолдер — заменить на реальное (согласовано с metadata layout.tsx). */
  name: 'АРТЕМИЙ',
  role: 'AI-инженер',
  label: 'ai-инженер · 35 дней челленджа',
  positioning: 'Строю AI-системы целиком: LLM-агенты, RAG, MCP, TG-автоматизация.',
  intro:
    'Собираю локальные LLM-пайплайны end-to-end — от эмбеддингов и индекса до web-интерфейса. ' +
    'Без облака там, где можно без облака: Ollama на ноутбуке, наружу только то, что нельзя локально.',
};

// --- S2. Proof-of-work (челлендж) ---

export const challengeNarrative =
  '35 дней подряд, каждый день — новая подсистема: RAG-движок, MCP-серверы, MTProto-userbot, ' +
  'web-дашборд. Каждый день проходит строгий typecheck; security-инварианты — секреты только в .env, ' +
  'parameterized SQL, allowlist для внешних fetch. Результат — работающий стэк, а не список технологий.';

export const challengeMetrics = [
  { value: '35', label: 'дней челленджа' },
  { value: '26', label: 'демо в registry' },
  { value: '7', label: 'MCP-серверов' },
  { value: '3', label: 'LLM-провайдера' },
] as const;

export const challengeFootnote = '5 RAG-партиций · 82 коммита в main';

export const milestones = [
  {
    days: '18–20',
    title: 'MCP + Telegram-напоминания',
    desc: 'Свои MCP-серверы, Bot API, ежедневные сводки задач.',
  },
  {
    days: '21–24',
    title: 'RAG-движок',
    desc: 'Индекс → запрос → rerank → guard «не знаю».',
  },
  {
    days: '25',
    title: 'Память диалога и задачи',
    desc: '3 слоя памяти, ветвление, cross-chat past-Q&A.',
  },
  {
    days: '28–30',
    title: 'Web-UI Next.js 15 + LLM-gateway',
    desc: '23 раздела дашборда, приватный OpenAI-compat gateway.',
  },
  {
    days: '31–33',
    title: 'dev-assistant · PR-ревью · support',
    desc: '/ask RAG по docs, авто-ревью PR через Claude, CRM+faq.',
  },
  {
    days: '34–35',
    title: 'Файловый агент · лендинг',
    desc: 'Агентный рефакторинг кода, design-system SoT.',
  },
] as const;

// --- S3. Продукты (proof-карточки; href — live-маршрут как артефакт, кликабелен только админ) ---

export const products = [
  {
    badge: '/rag/chat',
    title: 'RAG-движок',
    desc: 'local-embed → rerank → цитаты; guard «не знаю». Ollama native.',
    href: '/rag/chat',
    icon: 'database',
  },
  {
    badge: '/joker',
    title: 'Кино-Шутник',
    desc: 'CINE-PUN чат; локальная qwen3.5:4b; факты 8с + shuffle.',
    href: '/joker',
    icon: 'sparkles',
  },
  {
    badge: '/mcp/tools',
    title: 'MCP round-trip',
    desc: 'Свои MCP-серверы (crm/files); deterministic, no LLM-loop.',
    href: '/mcp/tools',
    icon: 'plug',
  },
  {
    badge: '/tg/top',
    title: 'TG MTProto',
    desc: 'Userbot; forum-топики → индекс. RSS sports.ru/championat.',
    href: '/tg/top',
    icon: 'send',
  },
  {
    badge: '/blog/pipeline',
    title: 'Blog pipeline',
    desc: 'RSS → sanitize → БД → дашборд. FSM plan/execute/validate.',
    href: '/blog/pipeline',
    icon: 'rss',
  },
  {
    badge: '/chat',
    title: 'Dialog memory',
    desc: '3 слоя памяти · ветвление · профили · cross-chat past-Q&A.',
    href: '/chat',
    icon: 'messages',
  },
] as const satisfies ReadonlyArray<{
  badge: string;
  title: string;
  desc: string;
  href: string;
  icon: LandingIconId;
}>;

// --- S4. Навыки / ядро компетенций ---

export const core = [
  {
    title: 'RAG pipeline',
    desc: 'embed → cosine → rerank → guard. 5 партиций: fixed, structure, telegram, docs, faq.',
    icon: 'database',
  },
  {
    title: 'MCP round-trip',
    desc: 'HTTP/STDIO-server-конструктор + client + orchestrator. 7 запускаемых серверов in-repo.',
    icon: 'plug',
  },
  {
    title: 'LLM-gateway',
    desc: '3 провайдера: DeepSeek (cloud), OpenRouter (Claude/Gemini), Ollama (local qwen3.5:4b).',
    icon: 'cpu',
  },
  {
    title: 'TG MTProto',
    desc: 'Userbot через telegram lib. RSS sports.ru/championat.com → БД → индекс → дашборд.',
    icon: 'send',
  },
] as const satisfies ReadonlyArray<{ title: string; desc: string; icon: LandingIconId }>;

export const stackLine =
  'TypeScript strict · Node.js 24 · Next.js 15 · React 19 · node:sqlite · Ollama / DeepSeek / OpenRouter · gramjs';

export const principles = 'security-first · strict TypeScript · surgical changes · typecheck-гейт';

// --- S5. Контакты (плейсхолдеры — заменить на реальные) ---

export const contacts = [
  { label: 'Email', value: 'artemy@example.com', href: 'mailto:artemy@example.com' },
  { label: 'Telegram', value: '@artemy_ai', href: 'https://t.me/artemy_ai' },
  { label: 'GitHub', value: 'github.com/artemy', href: 'https://github.com/artemy' },
] as const;
