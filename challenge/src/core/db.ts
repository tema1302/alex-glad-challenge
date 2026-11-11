// Слой персистентности через node:sqlite (встроен в Node 24, без нативных сборок).
// Хранит блоги, новости, посты и образцы стиля.
//
// Мульти-блог: таблица blogs (голос-профиль, свой TG-чат, свои RSS-источники) +
// blog_id в news/posts/style_samples. blog_id NULL = легаси-запись без блога
// (старые прогоны REPL/CLI-демо) — видна только в выборках «все блоги».
// Миграция идемпотентная, в конструкторе: seed блогов при пустой таблице +
// ALTER/бэкфилл существующих строк в блог по умолчанию при первом обновлении.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import type { StylePreset } from './stylePreset.js';
import { resolveStylePreset } from './stylePreset.js';

export interface BlogRow {
  id: number;
  slug: string;
  name: string;
  profile: string | null;    // имя профиля голоса в .data/profiles/<name>.json
  tg_chat_id: string | null; // chat_id TG-канала блога; null = общий TG_CHAT_ID
  sources: string | null;    // JSON-массив URL RSS; null = дефолтные футбольные фиды
  style_preset: StylePreset; // пресет стиля (stylePreset.ts); 'default' = профиль + few-shot
  system_prompt: string | null;  // per-blog override системного промпта; null = пресет/шаблон
  context_prompt: string | null; // постоянный контекст блога (факты, аудитория, тон)
  archived_at: string | null;    // null = активен; ISO-время = архив (данные сохраняются)
  created_at: string;
}

export interface BlogAgentPromptRow {
  id: number;
  blog_id: number;
  agent: string;
  prompt: string;
  updated_at: string;
}

export interface BlogStats {
  posts: number;
  news: number;
  styleSamples: number;
  postsLast7Days: number;
  lastPostAt: string | null;
}

export interface CreateBlogInput {
  slug: string;
  name: string;
  profile?: string | null;
  tg_chat_id?: string | null;
  sources?: string | null;
  style_preset?: StylePreset;
  system_prompt?: string | null;
  context_prompt?: string | null;
}

// Блог по умолчанию: весь существующий контент и дефолтные RSS-фиды — его.
export const DEFAULT_BLOG_SLUG = 'lookatfacts';

// Начальный состав блогов (seed при пустой таблице). Профили голоса и источники
// двух новых блогов заполняются позже (PATCH /api/blogs/[slug], профили — /chat).
// Блог «Факты» (lookatfacts) пишет пресетом Антонова (stylePreset.ts).
const SEED_BLOGS: Array<Omit<BlogRow, 'id' | 'created_at'>> = [
  { slug: DEFAULT_BLOG_SLUG, name: 'Иди на факты глянь', profile: 'default', tg_chat_id: null, sources: null, style_preset: 'antonov', system_prompt: null, context_prompt: null, archived_at: null },
  { slug: 'artemia-artel', name: 'Артемия Артель', profile: null, tg_chat_id: null, sources: null, style_preset: 'default', system_prompt: null, context_prompt: null, archived_at: null },
  { slug: 'nevsky-hram', name: 'Невский храм на Доваторцев', profile: null, tg_chat_id: null, sources: null, style_preset: 'default', system_prompt: null, context_prompt: null, archived_at: null },
];

export interface NewsRow {
  id: number;
  url: string;
  title: string;
  summary: string;
  published_at: string;        // ISO
  source: string;
  used: number;                // 0/1
  created_at: string;
  blog_id: number | null;
}

export interface PostRow {
  id: number;
  news_id: number | null;
  content: string;
  verdict: string | null;      // результат фактчекинга
  topic: string | null;        // тема ручного/праздничного поста (news_id null)
  variant: number;             // 0 = базовый; 1..N-1 — альтернативные подачи
  created_at: string;
  blog_id: number | null;
}

export interface StyleSampleRow {
  id: number;
  text: string;
  created_at: string;
  blog_id: number | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS blogs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  profile TEXT,
  tg_chat_id TEXT,
  sources TEXT,
  style_preset TEXT NOT NULL DEFAULT 'default',
  system_prompt TEXT,
  context_prompt TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS blog_agent_prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blog_id INTEGER NOT NULL,
  agent TEXT NOT NULL,
  prompt TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (blog_id, agent)
);

CREATE TABLE IF NOT EXISTS news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  published_at TEXT NOT NULL,
  source TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  blog_id INTEGER
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  news_id INTEGER,
  content TEXT NOT NULL,
  verdict TEXT,
  topic TEXT,
  variant INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  blog_id INTEGER,
  FOREIGN KEY (news_id) REFERENCES news(id)
);

CREATE TABLE IF NOT EXISTS style_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  blog_id INTEGER
);

CREATE INDEX IF NOT EXISTS idx_news_published ON news(published_at);
CREATE INDEX IF NOT EXISTS idx_news_used ON news(used);
`;

export class BlogDb {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(SCHEMA);
    this.migrateBlogs();
  }

  close(): void {
    this.db.close();
  }

  // --- миграция мульти-блога (идемпотентно, при каждом открытии) ---
  private migrateBlogs(): void {
    const seeded = this.seedBlogs();
    // Колонка style_preset: на свежей БД уже в CREATE (seed проставил 'antonov'
    // блогу «Факты»). На легаси-базе — ALTER + разовый апдейт блога по умолчанию;
    // повторно не трогаем, чтобы не перетирать выбор пользователя.
    if (!this.hasColumn('blogs', 'style_preset')) {
      this.db.exec(`ALTER TABLE blogs ADD COLUMN style_preset TEXT NOT NULL DEFAULT 'default'`);
      this.db
        .prepare(`UPDATE blogs SET style_preset = 'antonov' WHERE slug = ?`)
        .run(DEFAULT_BLOG_SLUG);
    }
    // Per-blog промпты: явный system_prompt замещает пресет/шаблон, context_prompt
    // добавляет постоянный контекст. Старые БД получают NULL — поведение не меняется.
    if (!this.hasColumn('blogs', 'system_prompt')) {
      this.db.exec('ALTER TABLE blogs ADD COLUMN system_prompt TEXT');
    }
    if (!this.hasColumn('blogs', 'context_prompt')) {
      this.db.exec('ALTER TABLE blogs ADD COLUMN context_prompt TEXT');
    }
    // Архив вместо удаления: данные постов/новостей/расписания остаются, блог
    // скрывается из селекторов и не запускает автоматизацию.
    if (!this.hasColumn('blogs', 'archived_at')) {
      this.db.exec('ALTER TABLE blogs ADD COLUMN archived_at TEXT');
    }
    // На базах, созданных до мульти-блога, колонок нет — ALTER + разовый бэкфилл
    // всего существующего контента в блог по умолчанию. На свежей БД колонки уже
    // в CREATE, строк нет — бэкфилл не нужен.
    const backfillTo = seeded ? this.defaultBlogId() : null;
    for (const table of ['news', 'posts', 'style_samples']) {
      if (!this.hasColumn(table, 'blog_id')) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN blog_id INTEGER`);
        if (backfillTo !== null) {
          this.db
            .prepare(`UPDATE ${table} SET blog_id = ? WHERE blog_id IS NULL`)
            .run(backfillTo);
        }
      }
    }
    // Ручные/праздничные посты: тема и номер варианта (0 = базовый).
    if (!this.hasColumn('posts', 'topic')) {
      this.db.exec('ALTER TABLE posts ADD COLUMN topic TEXT');
    }
    if (!this.hasColumn('posts', 'variant')) {
      this.db.exec('ALTER TABLE posts ADD COLUMN variant INTEGER NOT NULL DEFAULT 0');
    }
    // Индексы blog-колонок здесь, а не в SCHEMA: на легаси-базе колонка появляется
    // только в ALTER выше — CREATE INDEX по ней упал бы до этого.
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_news_blog ON news(blog_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_posts_blog ON posts(blog_id)');
  }

  private hasColumn(table: string, column: string): boolean {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return rows.some((r) => r.name === column);
  }

  // Seed при пустой таблице. true = таблица была пуста (свежая БД или
  // до-мультибложная) — сигнал для бэкфилла.
  private seedBlogs(): boolean {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM blogs').get() as { n: number };
    if (row.n > 0) return false;
    const stmt = this.db.prepare(
      'INSERT INTO blogs (slug, name, profile, tg_chat_id, sources, style_preset) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (const b of SEED_BLOGS) {
      stmt.run(b.slug, b.name, b.profile, b.tg_chat_id, b.sources, b.style_preset);
    }
    return true;
  }

  private defaultBlogId(): number | null {
    const row = this.db
      .prepare('SELECT id FROM blogs WHERE slug = ?')
      .get(DEFAULT_BLOG_SLUG) as { id: number } | undefined;
    return row ? Number(row.id) : null;
  }

  // --- blogs ---
  listBlogs(): BlogRow[] {
    return this.db
      .prepare('SELECT * FROM blogs ORDER BY id')
      .all() as unknown as BlogRow[];
  }

  getBlog(id: number): BlogRow | null {
    const row = this.db.prepare('SELECT * FROM blogs WHERE id = ?').get(id);
    return (row ?? null) as BlogRow | null;
  }

  getBlogBySlug(slug: string): BlogRow | null {
    const row = this.db.prepare('SELECT * FROM blogs WHERE slug = ?').get(slug);
    return (row ?? null) as BlogRow | null;
  }

  // Создание блога из UI/API. UNIQUE(slug) — последняя линия защиты; route
  // проверяет дубль заранее, чтобы отдать 409 с понятным сообщением.
  createBlog(input: CreateBlogInput): BlogRow {
    const stmt = this.db.prepare(
      'INSERT INTO blogs (slug, name, profile, tg_chat_id, sources, style_preset, system_prompt, context_prompt, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)',
    );
    const result = stmt.run(
      input.slug,
      input.name,
      input.profile ?? null,
      input.tg_chat_id ?? null,
      input.sources ?? null,
      input.style_preset ?? 'default',
      input.system_prompt ?? null,
      input.context_prompt ?? null,
    );
    const row = this.getBlog(Number(result.lastInsertRowid));
    if (!row) throw new Error('созданный блог не найден');
    return row;
  }

  setBlogArchived(id: number, archived: boolean): void {
    this.db
      .prepare('UPDATE blogs SET archived_at = ? WHERE id = ?')
      .run(archived ? new Date().toISOString() : null, id);
  }

  blogStats(blogId: number): BlogStats {
    const row = this.db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM posts WHERE blog_id = ?) AS posts,
           (SELECT COUNT(*) FROM news WHERE blog_id = ?) AS news,
           (SELECT COUNT(*) FROM style_samples WHERE blog_id = ?) AS styleSamples,
           (SELECT COUNT(*) FROM posts WHERE blog_id = ? AND created_at >= datetime('now', '-7 days')) AS postsLast7Days,
           (SELECT MAX(created_at) FROM posts WHERE blog_id = ?) AS lastPostAt`,
      )
      .get(blogId, blogId, blogId, blogId, blogId) as unknown as {
      posts: number;
      news: number;
      styleSamples: number;
      postsLast7Days: number;
      lastPostAt: string | null;
    };
    return {
      posts: Number(row.posts),
      news: Number(row.news),
      styleSamples: Number(row.styleSamples),
      postsLast7Days: Number(row.postsLast7Days),
      lastPostAt: row.lastPostAt,
    };
  }

  // Все блоги со статистикой одним проходом (для списка/пульса).
  listBlogStats(): Array<BlogRow & BlogStats> {
    const rows = this.listBlogs();
    return rows.map((blog) => ({ ...blog, ...this.blogStats(blog.id) }));
  }

  // --- blog_agent_prompts ---
  listAgentPrompts(blogId: number): BlogAgentPromptRow[] {
    return this.db
      .prepare('SELECT * FROM blog_agent_prompts WHERE blog_id = ? ORDER BY agent')
      .all(blogId) as unknown as BlogAgentPromptRow[];
  }

  getAgentPrompt(blogId: number, agent: string): BlogAgentPromptRow | null {
    const row = this.db
      .prepare('SELECT * FROM blog_agent_prompts WHERE blog_id = ? AND agent = ?')
      .get(blogId, agent);
    return (row ?? null) as BlogAgentPromptRow | null;
  }

  setAgentPrompt(blogId: number, agent: string, prompt: string): void {
    this.db
      .prepare(
        `INSERT INTO blog_agent_prompts (blog_id, agent, prompt, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(blog_id, agent) DO UPDATE SET
           prompt = excluded.prompt,
           updated_at = datetime('now')`,
      )
      .run(blogId, agent, prompt);
  }

  clearAgentPrompt(blogId: number, agent: string): boolean {
    const result = this.db
      .prepare('DELETE FROM blog_agent_prompts WHERE blog_id = ? AND agent = ?')
      .run(blogId, agent);
    return result.changes > 0;
  }

  agentPromptsCount(blogId: number): number {
    // post.writer исторически живёт в blogs.system_prompt — считаем его
    // эффективным override'ом, иначе UI показывал бы 0/8 после настройки автора.
    const row = this.db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM blog_agent_prompts
              WHERE blog_id = ? AND TRIM(prompt) <> '') +
           (SELECT CASE WHEN TRIM(COALESCE(system_prompt, '')) <> '' THEN 1 ELSE 0 END
              FROM blogs WHERE id = ?) AS n`,
      )
      .get(blogId, blogId) as { n: number };
    return Number(row.n);
  }

  updateBlog(
    id: number,
    patch: {
      name?: string;
      profile?: string | null;
      tg_chat_id?: string | null;
      sources?: string | null;
      style_preset?: StylePreset;
      system_prompt?: string | null;
      context_prompt?: string | null;
      archived_at?: string | null;
    },
  ): void {
    const sets: string[] = [];
    const values: Array<string | null> = [];
    for (const key of [
      'name',
      'profile',
      'tg_chat_id',
      'sources',
      'style_preset',
      'system_prompt',
      'context_prompt',
      'archived_at',
    ] as const) {
      const val = patch[key];
      if (val !== undefined) {
        sets.push(`${key} = ?`);
        values.push(val);
      }
    }
    if (sets.length === 0) return;
    this.db.prepare(`UPDATE blogs SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
  }

  // Пресет стиля блога; отсутствующий блог/неизвестное значение → 'default'.
  getStylePreset(id: number): StylePreset {
    return resolveStylePreset(this.getBlog(id)?.style_preset);
  }

  // --- news ---
  insertNews(
    row: Omit<NewsRow, 'id' | 'used' | 'created_at' | 'blog_id'>,
    blogId?: number | null,
  ): boolean {
    try {
      this.db
        .prepare(
          'INSERT INTO news (url, title, summary, published_at, source, blog_id) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(row.url, row.title, row.summary, row.published_at, row.source, blogId ?? null);
      return true;
    } catch {
      return false; // UNIQUE conflict — уже в базе
    }
  }

  unusedNewsSince(iso: string, blogId?: number | null): NewsRow[] {
    const sql =
      'SELECT * FROM news WHERE used = 0 AND published_at >= ?' +
      (blogId != null ? ' AND blog_id = ?' : '') +
      ' ORDER BY published_at DESC';
    return this.db
      .prepare(sql)
      .all(...(blogId != null ? [iso, blogId] : [iso])) as unknown as NewsRow[];
  }

  // Все новости (включая used) с даты — окно еженедельного дайджеста.
  newsSince(iso: string, blogId?: number | null): NewsRow[] {
    const sql =
      'SELECT * FROM news WHERE published_at >= ?' +
      (blogId != null ? ' AND blog_id = ?' : '') +
      ' ORDER BY published_at DESC';
    return this.db
      .prepare(sql)
      .all(...(blogId != null ? [iso, blogId] : [iso])) as unknown as NewsRow[];
  }

  markUsed(id: number): void {
    this.db.prepare('UPDATE news SET used = 1 WHERE id = ?').run(id);
  }

  // --- posts ---
  insertPost(
    content: string,
    newsId: number | null,
    verdict: string | null = null,
    blogId?: number | null,
    topic: string | null = null,
    variant = 0,
  ): number {
    const stmt = this.db.prepare(
      'INSERT INTO posts (news_id, content, verdict, blog_id, topic, variant) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const result = stmt.run(newsId, content, verdict, blogId ?? null, topic, variant);
    return Number(result.lastInsertRowid);
  }

  recentPosts(limit = 10, blogId?: number | null): PostRow[] {
    const sql =
      'SELECT * FROM posts' +
      (blogId != null ? ' WHERE blog_id = ?' : '') +
      ' ORDER BY created_at DESC LIMIT ?';
    return this.db
      .prepare(sql)
      .all(...(blogId != null ? [blogId, limit] : [limit])) as unknown as PostRow[];
  }

  getPost(id: number): PostRow | null {
    const row = this.db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
    return (row ?? null) as PostRow | null;
  }

  updatePostContent(id: number, content: string): void {
    this.db.prepare('UPDATE posts SET content = ? WHERE id = ?').run(content, id);
  }

  deletePost(id: number): boolean {
    const result = this.db.prepare('DELETE FROM posts WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // --- style_samples ---
  addStyleSample(text: string, blogId?: number | null): boolean {
    try {
      this.db
        .prepare('INSERT INTO style_samples (text, blog_id) VALUES (?, ?)')
        .run(text, blogId ?? null);
      return true;
    } catch {
      return false;
    }
  }

  styleSamples(limit = 10, blogId?: number | null): StyleSampleRow[] {
    const sql =
      'SELECT * FROM style_samples' +
      (blogId != null ? ' WHERE blog_id = ?' : '') +
      ' ORDER BY RANDOM() LIMIT ?';
    return this.db
      .prepare(sql)
      .all(...(blogId != null ? [blogId, limit] : [limit])) as unknown as StyleSampleRow[];
  }

  styleSamplesCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM style_samples').get() as { n: number };
    return row.n;
  }

  newsCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM news').get() as { n: number };
    return row.n;
  }

  postsCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM posts').get() as { n: number };
    return row.n;
  }
}
