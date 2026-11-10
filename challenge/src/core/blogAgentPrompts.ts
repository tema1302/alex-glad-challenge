// Реестр LLM-агентов блог-пайплайна и резолвер per-blog промптов.
//
// Контракт: пользователь переопределяет только смысловую часть промпта (роль,
// стиль, критерии). JSON-схемы, severity-правила, grounding и данные источника
// добавляются кодом агента и не редактируются — иначе один неаккуратный override
// ломает машинный контракт фактчекера/ранжирования.
//
// Порядок разрешения:
//   1. blog_agent_prompts(blog_id, agent) — явный override;
//   2. blogs.system_prompt — легаси-fallback только для post.writer/post.topic;
//   3. presetSystemPrompt(blogs.style_preset);
//   4. встроенный default агента.
// blog === null (CLI/REPL/legacy) сразу получает default: поведение не меняется.

import type { BlogDb, BlogRow } from './db.js';
import { presetSystemPrompt, resolveStylePreset } from './stylePreset.js';

export const BLOG_AGENT_IDS = [
  'post.writer',
  'post.topic',
  'scout.news',
  'scout.orchestrator',
  'factcheck.reasoning',
  'factcheck.verdict',
  'digest.weekly',
] as const;

export type BlogAgentId = (typeof BLOG_AGENT_IDS)[number];

export type BlogAgentPromptSource =
  | 'blog'
  | 'legacy-blog-system'
  | 'preset'
  | 'default';

export interface BlogAgentSpec {
  readonly id: BlogAgentId;
  readonly label: string;
  readonly description: string;
  /** Текст встроенного поведения для предпросмотра. Динамика — в {{...}}. */
  readonly defaultPrompt: string;
  readonly maxLength: number;
  /** Что именно заменяет override; остальное добавляет код. */
  readonly editableScope: string;
  readonly group: 'content' | 'scout' | 'quality' | 'service';
}

const MAX_PROMPT_LENGTH = 8000;

export const BLOG_AGENT_SPECS: readonly BlogAgentSpec[] = [
  {
    id: 'post.writer',
    label: 'Автор поста',
    description: 'Пишет пост по свежей новости голосом блога.',
    group: 'content',
    defaultPrompt: [
      'Ты — автор Telegram-канала «{{channel}}» ({{topic}}).',
      'Ты пишешь {{style}}. Язык: {{language}}.',
      'ОБЪЁМ: {{length}}. ФОРМАТ: {{format}}. ЭМОДЗИ: {{emoji}}.',
      'Не выдумывай факты, которых нет в источнике. Не обрезай пост на полуслове.',
    ].join('\n'),
    editableScope:
      'Роль, стиль и правила. Шапка канала, подпись, табу, профиль голоса и контекст блога добавляются автоматически.',
    maxLength: MAX_PROMPT_LENGTH,
  },
  {
    id: 'post.topic',
    label: 'Автор по теме',
    description: 'Пишет пост по свободной теме: праздник, объявление, заметка.',
    group: 'content',
    defaultPrompt: [
      'Ты — автор Telegram-канала «{{channel}}».',
      'Пиши живым, человеческим языком, без канцелярита, штампов и пафоса.',
      'Не выдумывай факты, цитаты, даты и имена, которых нет в теме/контексте.',
    ].join('\n'),
    editableScope:
      'Роль и стиль. Угол подачи варианта, канал, подпись, табу и контекст добавляются автоматически.',
    maxLength: MAX_PROMPT_LENGTH,
  },
  {
    id: 'scout.news',
    label: 'Разведчик новостей',
    description: 'Выбирает самые важные новости из пула RSS для поста.',
    group: 'scout',
    defaultPrompt: [
      'Из списка новостей ниже выбери топ-{{topK}} самых важных для аудитории канала.',
      'Приоритет: {{priority}}.',
      'Ответ — строго JSON-массив, без рассуждений.',
    ].join('\n'),
    editableScope:
      'Критерии отбора и приоритет. JSON-контракт, индексы и ограничение topK добавляются автоматически.',
    maxLength: MAX_PROMPT_LENGTH,
  },
  {
    id: 'scout.orchestrator',
    label: 'Оркестратор тем',
    description: 'Сводит темы трёх источников в топ и объясняет выбор.',
    group: 'scout',
    defaultPrompt: [
      'Ты спортивный редактор-оркестратор. Тебе пришли темы от трёх источников.',
      'Выбери топ-{{topK}} самых актуальных и обсуждаемых тем для поста.',
      'Учитывай совпадения между источниками, обсуждения и релевантность запросу.',
    ].join('\n'),
    editableScope:
      'Роль и критерии выбора. Список тем, запрос и JSON-контракт добавляются автоматически.',
    maxLength: MAX_PROMPT_LENGTH,
  },
  {
    id: 'factcheck.reasoning',
    label: 'Фактчекер: рассуждение',
    description: 'Пошагово сверяет факты поста с источником.',
    group: 'quality',
    defaultPrompt: [
      'Ты строгий редактор-фактчекер Telegram-канала «{{channel}}».',
      'Не выноси финальный вердикт — распиши проверку по шагам:',
      'имена, названия, результаты, даты, суммы, цитаты и числа.',
    ].join('\n'),
    editableScope:
      'Роль и чек-лист проверки. Источник, пост и требование к рассуждению добавляются автоматически.',
    maxLength: MAX_PROMPT_LENGTH,
  },
  {
    id: 'factcheck.verdict',
    label: 'Фактчекер: вердикт',
    description: 'Выносит ok/needs_revision и список расхождений.',
    group: 'quality',
    defaultPrompt: [
      'Ты строгий редактор-фактчекер Telegram-канала «{{channel}}».',
      'На основе рассуждений прими финальное решение о публикации.',
    ].join('\n'),
    editableScope:
      'Роль. JSON-схема, severity-правила и fail-closed парсинг не редактируются.',
    maxLength: MAX_PROMPT_LENGTH,
  },
  {
    id: 'digest.weekly',
    label: 'Дайджест недели',
    description: 'Собирает недельную подборку новостей с ссылками.',
    group: 'content',
    defaultPrompt: [
      'Ты — редактор телеграм-канала «{{channel}}» ({{topic}}). Собираешь дайджест недели.',
      'Формат: заголовок + 5-7 пунктов «заголовок — 1-2 предложения — URL».',
      'Plain text, без HTML/Markdown-разметки.',
    ].join('\n'),
    editableScope:
      'Роль и правила формата. Grounding-правила, список новостей, URL и clamp 4096 добавляются автоматически.',
    maxLength: MAX_PROMPT_LENGTH,
  },
];

export const BLOG_AGENT_SOURCE_LABELS: Record<BlogAgentPromptSource, string> = {
  blog: 'переопределён для блога',
  'legacy-blog-system': 'унаследован из системного промпта',
  preset: 'пресет стиля',
  default: 'встроенный по умолчанию',
};

export function findBlogAgentSpec(id: string): BlogAgentSpec | null {
  return BLOG_AGENT_SPECS.find((spec) => spec.id === id) ?? null;
}

/** Подставляет {{переменные}} в пользовательский override, не трогая неизвестные. */
export function applyPromptVars(
  prompt: string,
  vars: Readonly<Record<string, string | number | null | undefined>>,
): string {
  return prompt.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = vars[key];
    return value === null || value === undefined ? match : String(value);
  });
}

export interface ResolvedBlogAgentPrompt {
  readonly agent: BlogAgentId;
  /** null = использовать встроенный default агента. */
  readonly prompt: string | null;
  readonly source: BlogAgentPromptSource;
}

type AgentPromptLookup = Pick<BlogDb, 'getAgentPrompt'>;

export function resolveBlogAgentPrompt(
  db: AgentPromptLookup,
  blog: BlogRow | null,
  agent: BlogAgentId,
): ResolvedBlogAgentPrompt {
  if (!blog) return { agent, prompt: null, source: 'default' };

  const row = db.getAgentPrompt(blog.id, agent);
  if (row !== null) {
    const stored = row.prompt.trim();
    if (stored) return { agent, prompt: stored, source: 'blog' };
    // Пустая строка — явный tombstone «сброшен пользователем»: он перекрывает
    // легаси system_prompt и пресет, иначе reset для post.topic был бы no-op.
    return { agent, prompt: null, source: 'default' };
  }

  // Легаси-совместимость: два «авторских» агента исторически читали
  // blogs.system_prompt. Остальные агенты его не наследуют.
  if (agent === 'post.writer' || agent === 'post.topic') {
    const legacy = blog.system_prompt?.trim();
    if (legacy) return { agent, prompt: legacy, source: 'legacy-blog-system' };

    const preset = presetSystemPrompt(resolveStylePreset(blog.style_preset));
    if (preset) return { agent, prompt: preset, source: 'preset' };
  }

  return { agent, prompt: null, source: 'default' };
}
