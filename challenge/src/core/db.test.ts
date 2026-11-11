import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { BlogDb, DEFAULT_BLOG_SLUG } from './db.js';

// Windows: WAL-дескрипторы могут пережить close() до GC — EPERM на rmSync
// не является провалом теста.
function safeRm(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'EBUSY') throw e;
  }
}

function tmpDb(): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'blogdb-'));
  return { dir, file: path.join(dir, 'blog.sqlite') };
}

test('db: свежий seed — блог «Факты» получает preset antonov, остальные default', () => {
  const { dir, file } = tmpDb();
  const db = new BlogDb(file);
  try {
    const fakty = db.getBlogBySlug(DEFAULT_BLOG_SLUG);
    assert.equal(fakty?.style_preset, 'antonov');
    assert.equal(db.getStylePreset(fakty!.id), 'antonov');
    const others = db.listBlogs().filter((b) => b.slug !== DEFAULT_BLOG_SLUG);
    assert.ok(others.length > 0);
    for (const b of others) assert.equal(b.style_preset, 'default');
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('db: updateBlog меняет style_preset, повторное открытие его не перетирает', () => {
  const { dir, file } = tmpDb();
  let db = new BlogDb(file);
  try {
    const blog = db.getBlogBySlug(DEFAULT_BLOG_SLUG)!;
    db.updateBlog(blog.id, { style_preset: 'default' });
    assert.equal(db.getBlogBySlug(DEFAULT_BLOG_SLUG)?.style_preset, 'default');
    db.updateBlog(blog.id, { style_preset: 'antonov' });
    assert.equal(db.getStylePreset(blog.id), 'antonov');
  } finally {
    db.close();
  }
  db = new BlogDb(file);
  try {
    assert.equal(db.getBlogBySlug(DEFAULT_BLOG_SLUG)?.style_preset, 'antonov');
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('db: system/context prompt — миграция легаси-базы и persist между открытиями', () => {
  const { dir, file } = tmpDb();
  const legacy = new DatabaseSync(file);
  legacy.exec(`
    CREATE TABLE blogs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      profile TEXT,
      tg_chat_id TEXT,
      sources TEXT,
      style_preset TEXT NOT NULL DEFAULT 'default',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  legacy
    .prepare('INSERT INTO blogs (slug, name, profile, tg_chat_id, sources) VALUES (?, ?, ?, ?, ?)')
    .run('nevsky-hram', 'Невский храм', null, null, null);
  legacy.close();

  let db = new BlogDb(file);
  try {
    const blog = db.getBlogBySlug('nevsky-hram')!;
    assert.equal(blog.system_prompt, null);
    assert.equal(blog.context_prompt, null);
    db.updateBlog(blog.id, {
      system_prompt: 'Пиши как прихожанин, тепло.',
      context_prompt: 'Настоятель — отец N.',
    });
  } finally {
    db.close();
  }
  db = new BlogDb(file);
  try {
    const blog = db.getBlogBySlug('nevsky-hram')!;
    assert.equal(blog.system_prompt, 'Пиши как прихожанин, тепло.');
    assert.equal(blog.context_prompt, 'Настоятель — отец N.');
    db.updateBlog(blog.id, { system_prompt: null, context_prompt: null });
    assert.equal(db.getBlogBySlug('nevsky-hram')?.system_prompt, null);
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('db: posts.topic/variant сохраняются (ручные посты и варианты)', () => {
  const { dir, file } = tmpDb();
  const db = new BlogDb(file);
  try {
    const blog = db.getBlogBySlug('nevsky-hram')!;
    const id = db.insertPost('Праздничный пост', null, null, blog.id, 'Рождество', 2);
    const post = db.getPost(id)!;
    assert.equal(post.topic, 'Рождество');
    assert.equal(post.variant, 2);
    assert.equal(post.news_id, null);
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('db: миграция легаси-базы — ALTER blogs + antonov блогу «Факты», идемпотентно', () => {
  const { dir, file } = tmpDb();
  // Легаси-схема: blogs без style_preset, с одним блогом «Факты».
  const legacy = new DatabaseSync(file);
  legacy.exec(`
    CREATE TABLE blogs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      profile TEXT,
      tg_chat_id TEXT,
      sources TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  legacy
    .prepare('INSERT INTO blogs (slug, name, profile, tg_chat_id, sources) VALUES (?, ?, ?, ?, ?)')
    .run(DEFAULT_BLOG_SLUG, 'Иди на факты глянь', 'default', null, null);
  legacy.close();

  let db = new BlogDb(file);
  try {
    const blog = db.getBlogBySlug(DEFAULT_BLOG_SLUG);
    assert.equal(blog?.style_preset, 'antonov');
    // Выбор пользователя важнее миграции: сбрасываем и переоткрываем.
    db.updateBlog(blog!.id, { style_preset: 'default' });
  } finally {
    db.close();
  }
  db = new BlogDb(file);
  try {
    assert.equal(db.getBlogBySlug(DEFAULT_BLOG_SLUG)?.style_preset, 'default');
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('db: createBlog + уникальный slug + архив', () => {
  const { dir, file } = tmpDb();
  const db = new BlogDb(file);
  try {
    const created = db.createBlog({
      slug: 'new-blog',
      name: 'Новый блог',
      profile: 'default',
      style_preset: 'default',
    });
    assert.equal(created.slug, 'new-blog');
    assert.equal(created.archived_at, null);
    assert.equal(db.getBlogBySlug('new-blog')?.name, 'Новый блог');
    assert.throws(() => db.createBlog({ slug: 'new-blog', name: 'Дубль' }));

    db.setBlogArchived(created.id, true);
    assert.ok(db.getBlog(created.id)?.archived_at);
    db.setBlogArchived(created.id, false);
    assert.equal(db.getBlog(created.id)?.archived_at, null);
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('db: blogStats считает посты/новости/стиль и последнюю активность по блогу', () => {
  const { dir, file } = tmpDb();
  const db = new BlogDb(file);
  try {
    const a = db.getBlogBySlug(DEFAULT_BLOG_SLUG)!;
    const b = db.getBlogBySlug('nevsky-hram')!;
    const now = new Date().toISOString();
    db.insertNews({ url: 'https://example.com/a', title: 'A', summary: 'A', published_at: now, source: 'rss' }, a.id);
    db.insertNews({ url: 'https://example.com/b', title: 'B', summary: 'B', published_at: now, source: 'rss' }, b.id);
    db.insertPost('Пост A', null, null, a.id);
    db.insertPost('Пост B1', null, null, b.id);
    db.insertPost('Пост B2', null, null, b.id);
    db.addStyleSample('образец', a.id);

    const statsA = db.blogStats(a.id);
    assert.equal(statsA.posts, 1);
    assert.equal(statsA.news, 1);
    assert.equal(statsA.styleSamples, 1);
    assert.equal(statsA.postsLast7Days, 1);
    assert.ok(statsA.lastPostAt);

    const statsB = db.blogStats(b.id);
    assert.equal(statsB.posts, 2);
    assert.equal(statsB.news, 1);
    assert.equal(statsB.styleSamples, 0);

    const all = db.listBlogStats();
    assert.equal(all.find((x) => x.id === b.id)?.posts, 2);
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('db: agent prompts — upsert, clear, count и persist', () => {
  const { dir, file } = tmpDb();
  let db = new BlogDb(file);
  const blogId = db.getBlogBySlug(DEFAULT_BLOG_SLUG)!.id;
  try {
    assert.equal(db.getAgentPrompt(blogId, 'factcheck.verdict'), null);
    db.setAgentPrompt(blogId, 'factcheck.verdict', 'строгий разбор');
    db.setAgentPrompt(blogId, 'factcheck.verdict', 'очень строгий разбор');
    assert.equal(db.getAgentPrompt(blogId, 'factcheck.verdict')?.prompt, 'очень строгий разбор');
    db.setAgentPrompt(blogId, 'digest.weekly', 'дайджест');
    assert.equal(db.agentPromptsCount(blogId), 2);
    db.updateBlog(blogId, { system_prompt: 'авторский системный промпт' });
    assert.equal(db.agentPromptsCount(blogId), 3, 'system_prompt считается writer-override');
    db.updateBlog(blogId, { system_prompt: null });
    assert.equal(db.agentPromptsCount(blogId), 2);
    assert.equal(db.listAgentPrompts(blogId).length, 2);
    assert.equal(db.clearAgentPrompt(blogId, 'digest.weekly'), true);
    assert.equal(db.clearAgentPrompt(blogId, 'digest.weekly'), false);
  } finally {
    db.close();
  }
  db = new BlogDb(file);
  try {
    assert.equal(db.getAgentPrompt(blogId, 'factcheck.verdict')?.prompt, 'очень строгий разбор');
    assert.equal(db.agentPromptsCount(blogId), 1);
  } finally {
    db.close();
    safeRm(dir);
  }
});
