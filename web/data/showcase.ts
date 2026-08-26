// Контент функциональной витрины (НЕ хронология дней): что система умеет на день 27
// по модулям + метаданные архитектуры/стека. Источник — фактическое состояние challenge/.
// Эти данные public (без секретов), рендерятся на /showcase.

export interface CapabilityItem {
  title: string;
  detail: string;
}

export interface CapabilitySection {
  id: string;
  title: string;
  icon: string;
  summary: string;
  items: CapabilityItem[];
}

export const capabilitySections: CapabilitySection[] = [
  {
    id: 'rag',
    title: 'RAG',
    icon: '🔎',
    summary: 'Поиск по знаниям с цитатами и guard «не знаю».',
    items: [
      { title: 'Single-shot query', detail: 'Запрос → retrieve/filter/rerank/LLM → ответ с цитатами [n] и источниками.' },
      { title: 'Чанки и стратегии', detail: 'fixed / structure / telegram; cosine brute-force по эмбеддингам Ollama.' },
      { title: 'RAG-чат (REPL)', detail: 'Сессии /chat /topic /list /alias, task-state (цель/термины/ограничения), cross-chat past-Q&A.' },
      { title: 'Index / tg-collect', detail: 'Индексация документов и форум-топиков Telegram (MTProto), фильтр по chat/topic.' },
      { title: 'Guard «не знаю»', detail: 'Пустой индекс / слабый контекст → отказ без LLM-галлюцинации.' },
    ],
  },
  {
    id: 'chat',
    title: 'Chat-агент',
    icon: '🧠',
    summary: 'Стратегии контекста, ветвление, память и профили.',
    items: [
      { title: 'Стратегии', detail: 'FullHistory / SlidingWindow / StickyFacts / Branching — переключаются в рантайме.' },
      { title: 'Ветвление (branching)', detail: 'Дерево веток диалога: создать/переключить, каждая со своей историей.' },
      { title: 'Память 3 слоя', detail: 'long-term (факты), short-term (окно), working (задача) — персистентно в .data.' },
      { title: 'Профили', detail: 'Профили пользователя; LLM-редактирование заметок, копии, сброс.' },
      { title: 'Constraints / Usage', detail: 'Явные ограничения диалога; счётчик токенов использования.' },
    ],
  },
  {
    id: 'blog',
    title: 'Блог',
    icon: '📰',
    summary: 'Пайплайн новостных постов и разведка источников.',
    items: [
      { title: 'News pipeline', detail: 'RSS-новости (sports.ru/championat/bbc) → пост в стиле канала.' },
      { title: 'Scout (3 агента)', detail: 'RSS / Forum / Telegram-агенты параллельно, оркестратор собирает топ.' },
      { title: 'Pipeline FSM', detail: 'Конечный автомат: idle → planning → execution → validation → revision → done.' },
      { title: 'Posts CRUD', detail: 'Список, детальный просмотр, правка, удаление; seed-style образцы стиля.' },
    ],
  },
  {
    id: 'telegram',
    title: 'Telegram',
    icon: '✈️',
    summary: 'MTProto userbot + Bot API.',
    items: [
      { title: 'MTProto сбор', detail: 'Userbot-сессия собирает forum-топики (сообщения, авторы, реакции).' },
      { title: 'Публикация', detail: 'Посты уходят в канал через Bot API.' },
      { title: 'Briefing', detail: 'Сводки/дайджесты по расписанию.' },
    ],
  },
  {
    id: 'mcp',
    title: 'MCP',
    icon: '🔌',
    summary: 'Model Context Protocol: свои серверы и клиенты.',
    items: [
      { title: 'TODO + Summary', detail: 'HTTP-MCP сервер с задачами и ежедневной сводкой в Telegram.' },
      { title: 'MCP→MCP', detail: 'Проксирование вызовов к удалённым серверам (Everything Server).' },
      { title: 'Свои MCP-серверы', detail: 'stdio/HTTP orchestrator, agent-loop, инструменты get_posts/todos/notes.' },
    ],
  },
  {
    id: 'memory',
    title: 'Memory',
    icon: '💾',
    summary: 'Персистентное состояние в SQLite через node:sqlite.',
    items: [
      { title: '.data/ — единый каталог', detail: 'blog/rag/tg/dialog/todos.sqlite, memory.json, profiles, MTProto-сессия.' },
      { title: 'WAL + parameterized SQL', detail: 'Множественные читатели; только ?-плейсхолдеры (SQLi-инвариант).' },
      { title: 'cwd-независимо', detail: 'core/paths.ts считает от расположения модуля — работает из CLI и из web.' },
    ],
  },
];

export interface LayerSpec {
  name: string;
  role: string;
  nodes: string[];
}

export const architectureLayers: LayerSpec[] = [
  {
    name: 'Поверхности',
    role: 'Точки входа для пользователя.',
    nodes: ['CLI (tsx)', 'REPL /chat /rag', 'Web (Next.js, 127.0.0.1)'],
  },
  {
    name: 'core/*',
    role: 'Доменная логика и агенты. Единая библиотека монолита.',
    nodes: ['LlmClient / OllamaNativeClient', 'rag / agents / strategy / memory', 'BlogDb / RagStore / TgStore / DialogDb / TodoDb'],
  },
  {
    name: 'Хранилище',
    role: 'SQLite через node:sqlite, WAL. Вне git.',
    nodes: ['локальные SQLite-базы (*.sqlite)', 'memory.json, profiles, tg-session.json'],
  },
];

export interface WebChokepointNote {
  title: string;
  detail: string;
}

export const webChokepoint: WebChokepointNote[] = [
  {
    title: 'server-only chokepoint',
    detail: 'web → единый server-only chokepoint → core. Ключи, MTProto-сессия и node:sqlite не покидают сервер.',
  },
  {
    title: 'Локально, без deploy',
    detail: 'next dev на 127.0.0.1. Шага production-build нет — это локальная dev-компиляция.',
  },
];

export interface StackGroup {
  name: string;
  items: string[];
}

export const stack: StackGroup[] = [
  {
    name: 'Ядро (CLI/агенты)',
    items: ['TypeScript (strict, ESM)', 'Node.js 24', 'node:sqlite (WAL)', 'tsx', 'gramjs (MTProto)', 'fast-xml-parser', 'undici', 'dotenv'],
  },
  {
    name: 'Web (web)',
    items: ['Next.js 15 (App Router)', 'React 19', 'Tailwind CSS 3', 'next-themes', 'zod', 'server-only'],
  },
];
