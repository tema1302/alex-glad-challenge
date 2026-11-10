// Серверные хелперы мульти-блога: резолв блога по slug/undefined, загрузка
// профиля голоса блога, разбор источников. Единственное место, знающее правила
// «undefined = блог по умолчанию» и «профиль обязателен для генерации».
import 'server-only';
import {
  DEFAULT_BLOG_SLUG,
  ProfileManager,
  dataPath,
  type BlogRow,
  type BlogStats,
} from './challenge';
import { getBlogDb, withDb } from './db';

export interface BlogResolution {
  blog: BlogRow | null;
  error?: string;
}

export interface BlogDto {
  id: number;
  slug: string;
  name: string;
  profile: string | null;
  hasProfile: boolean;
  tgChatId: string | null;
  tgChatIdSet: boolean;
  stylePreset: BlogRow['style_preset'];
  systemPrompt: string | null;
  contextPrompt: string | null;
  sources: string[];
  sourcesCount: number;
  status: 'active' | 'archived';
  archivedAt: string | null;
  createdAt: string;
  counts: BlogStats;
  lastPostAt: string | null;
  agentPromptsCount: number;
  readyForNews: boolean;
}

const EMPTY_STATS: BlogStats = {
  posts: 0,
  news: 0,
  styleSamples: 0,
  postsLast7Days: 0,
  lastPostAt: null,
};

// Единственный маппер BlogRow → JSON. До него PATCH отдавал snake_case, из-за чего
// веб и Android теряли поля (systemPrompt/sources), а settings падал на sources.length.
export function toBlogDto(
  blog: BlogRow,
  opts: {
    hasProfile?: boolean;
    stats?: BlogStats;
    agentPromptsCount?: number;
  } = {},
): BlogDto {
  const sources = blogSources(blog);
  const stats = opts.stats ?? EMPTY_STATS;
  const hasProfile = opts.hasProfile ?? false;
  return {
    id: blog.id,
    slug: blog.slug,
    name: blog.name,
    profile: blog.profile,
    hasProfile,
    tgChatId: blog.tg_chat_id,
    tgChatIdSet: blog.tg_chat_id !== null,
    stylePreset: blog.style_preset,
    systemPrompt: blog.system_prompt,
    contextPrompt: blog.context_prompt,
    sources,
    sourcesCount: sources.length,
    status: blog.archived_at ? 'archived' : 'active',
    archivedAt: blog.archived_at,
    createdAt: blog.created_at,
    counts: stats,
    lastPostAt: stats.lastPostAt,
    agentPromptsCount: opts.agentPromptsCount ?? 0,
    readyForNews: hasProfile && sources.length > 0,
  };
}

// Архивный блог нельзя генерировать/публиковать: UI скрывает его, но прямой
// API-вызов обязан получить явную ошибку, а не тихо создать контент.
export function blogArchivedError(blog: BlogRow): string | null {
  return blog.archived_at
    ? `Блог «${blog.name}» в архиве — верните его из архива, чтобы генерировать контент`
    : null;
}

export interface BlogPulseItem {
  id: number;
  slug: string;
  name: string;
  hasProfile: boolean;
  sourcesCount: number;
  readyForNews: boolean;
  counts: BlogStats;
  lastPostAt: string | null;
  agentPromptsCount: number;
}

export interface BlogPulseData {
  generatedAt: string;
  totals: {
    blogs: number;
    active: number;
    needsAttention: number;
    posts: number;
    postsLast7Days: number;
    customPrompts: number;
  };
  blogs: BlogPulseItem[];
}

// Пульс контента: только активные блоги, один проход, без N+1 SQL.
// Используется и route (/api/blog/pulse), и server component dashboard.
export async function readBlogPulse(): Promise<BlogPulseData> {
  return withDb(() => {
    const db = getBlogDb();
    const names = new ProfileManager(dataPath('profiles')).list();
    const blogs = db
      .listBlogs()
      .filter((blog) => blog.archived_at === null)
      .map((blog) => {
        const hasProfile = Boolean(blog.profile && names.includes(blog.profile));
        const sourcesCount = blogSources(blog).length;
        const stats = db.blogStats(blog.id);
        return {
          id: blog.id,
          slug: blog.slug,
          name: blog.name,
          hasProfile,
          sourcesCount,
          readyForNews: hasProfile && sourcesCount > 0,
          counts: stats,
          lastPostAt: stats.lastPostAt,
          agentPromptsCount: db.agentPromptsCount(blog.id),
        };
      });
    return {
      generatedAt: new Date().toISOString(),
      totals: {
        blogs: blogs.length,
        active: blogs.length,
        needsAttention: blogs.filter((b) => !b.readyForNews).length,
        posts: blogs.reduce((sum, b) => sum + b.counts.posts, 0),
        postsLast7Days: blogs.reduce((sum, b) => sum + b.counts.postsLast7Days, 0),
        customPrompts: blogs.reduce((sum, b) => sum + b.agentPromptsCount, 0),
      },
      blogs,
    };
  });
}

// blogRef = slug (или числовой id как строка). undefined → блог по умолчанию
// («Иди на факты глянь»); null → легаси-режим без блога (для вызовов без блога).
export function resolveBlog(blogRef?: string | null): BlogResolution {
  const db = getBlogDb();
  if (blogRef == null || blogRef === '') {
    return { blog: db.getBlogBySlug(DEFAULT_BLOG_SLUG) };
  }
  // Slug важнее numeric id: slug может быть «12», и он должен оставаться
  // адресуемым; числовой id — запасной вариант для старых вызовов.
  const bySlug = db.getBlogBySlug(blogRef);
  if (bySlug) return { blog: bySlug };
  const byId = Number(blogRef);
  const blog = Number.isInteger(byId) && byId > 0 ? db.getBlog(byId) : null;
  if (!blog) return { blog: null, error: `Блог «${blogRef}» не найден` };
  return { blog };
}

// Профиль голоса блога: null = не настроен (генерация для такого блога запрещена,
// иначе писатель молча взял бы дефолтный футбольный профиль).
export function loadBlogProfile(blog: BlogRow): ProfileManager | null {
  if (!blog.profile) return null;
  const mgr = new ProfileManager(dataPath('profiles'));
  if (!mgr.load(blog.profile)) return null;
  return mgr;
}

export function blogProfileMissing(blog: BlogRow): string {
  return blog.profile
    ? `Профиль голоса «${blog.profile}» для блога «${blog.name}» не найден — создайте его в /chat (/profile)`
    : `У блога «${blog.name}» не настроен профиль голоса — задайте его через /api/blogs/${blog.slug}`;
}

// blogs.sources — JSON-массив URL RSS; null/битый = [] (пайплайн возьмёт дефолт).
export function blogSources(blog: BlogRow): string[] {
  if (!blog.sources) return [];
  try {
    const parsed = JSON.parse(blog.sources) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(String).filter((u) => /^https?:\/\//.test(u));
  } catch {
    return [];
  }
}
