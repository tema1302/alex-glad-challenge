import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { BlogDb, DEFAULT_BLOG_SLUG } from './db.js';
import {
  BLOG_AGENT_IDS,
  BLOG_AGENT_SPECS,
  findBlogAgentSpec,
  resolveBlogAgentPrompt,
} from './blogAgentPrompts.js';

function tmpDb(): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'blog-prompts-'));
  return { dir, file: path.join(dir, 'blog.sqlite') };
}

function safeRm(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'EBUSY') throw e;
  }
}

test('blogAgentPrompts: ids и specs согласованы', () => {
  assert.equal(new Set(BLOG_AGENT_IDS).size, BLOG_AGENT_IDS.length);
  assert.equal(BLOG_AGENT_SPECS.length, BLOG_AGENT_IDS.length);
  for (const id of BLOG_AGENT_IDS) {
    const spec = findBlogAgentSpec(id);
    assert.ok(spec, `нет spec для ${id}`);
    assert.equal(spec.id, id);
    assert.ok(spec.label.length > 0);
    assert.ok(spec.description.length > 0);
    assert.ok(spec.defaultPrompt.length > 0);
    assert.ok(spec.editableScope.length > 0);
    assert.equal(spec.maxLength, 8000);
  }
  assert.equal(findBlogAgentSpec('unknown.agent'), null);
});

test('blogAgentPrompts: blog=null сразу default', () => {
  const { dir, file } = tmpDb();
  const db = new BlogDb(file);
  try {
    const resolved = resolveBlogAgentPrompt(db, null, 'factcheck.verdict');
    assert.equal(resolved.prompt, null);
    assert.equal(resolved.source, 'default');
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('blogAgentPrompts: override > legacy system prompt > preset > default', () => {
  const { dir, file } = tmpDb();
  const db = new BlogDb(file);
  try {
    const blog = db.getBlogBySlug(DEFAULT_BLOG_SLUG)!;
    // «Факты» засеяны пресетом antonov.
    assert.equal(resolveBlogAgentPrompt(db, blog, 'post.writer').source, 'preset');

    db.updateBlog(blog.id, { system_prompt: 'Легаси-промпт блога' });
    const legacy = resolveBlogAgentPrompt(db, db.getBlog(blog.id), 'post.writer');
    assert.equal(legacy.prompt, 'Легаси-промпт блога');
    assert.equal(legacy.source, 'legacy-blog-system');

    // Легаси system_prompt не влияет на остальных агентов.
    const fact = resolveBlogAgentPrompt(db, db.getBlog(blog.id), 'factcheck.reasoning');
    assert.equal(fact.prompt, null);
    assert.equal(fact.source, 'default');

    db.setAgentPrompt(blog.id, 'post.writer', 'Явный override');
    const override = resolveBlogAgentPrompt(db, db.getBlog(blog.id), 'post.writer');
    assert.equal(override.prompt, 'Явный override');
    assert.equal(override.source, 'blog');

    db.setAgentPrompt(blog.id, 'post.writer', '   ');
    const blank = resolveBlogAgentPrompt(db, db.getBlog(blog.id), 'post.writer');
    assert.equal(blank.prompt, 'Легаси-промпт блога');
    assert.equal(blank.source, 'legacy-blog-system');
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('blogAgentPrompts: отдельные override для writer и topic', () => {
  const { dir, file } = tmpDb();
  const db = new BlogDb(file);
  try {
    const blog = db.getBlogBySlug('nevsky-hram')!;
    assert.equal(resolveBlogAgentPrompt(db, blog, 'post.writer').source, 'default');
    db.setAgentPrompt(blog.id, 'post.topic', 'Только для постов по теме');
    const writer = resolveBlogAgentPrompt(db, blog, 'post.writer');
    const topic = resolveBlogAgentPrompt(db, blog, 'post.topic');
    assert.equal(writer.prompt, null);
    assert.equal(topic.prompt, 'Только для постов по теме');
    assert.equal(topic.source, 'blog');
  } finally {
    db.close();
    safeRm(dir);
  }
});
