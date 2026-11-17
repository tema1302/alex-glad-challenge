// Тесты pipeline: runNewsPipeline прокидывает blog.id в PostWriter.write.
// Регрессия: потеря blogId в writer.write молча уводит блог с пресетом
// (lookatfacts, style_preset='antonov') на default-стиль — пресет не применяется.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { BlogDb, DEFAULT_BLOG_SLUG } from '../db.js';
import { LlmClient } from '../client.js';
import type { ChatMessage } from '../types.js';
import { ANTONOV_SYSTEM_PROMPT } from '../stylePreset.js';
import { runNewsPipeline, runPostFromNews } from './pipeline.js';

// Windows: WAL-дескрипторы могут пережить close() до GC — EPERM на rmSync
// не является провалом теста (паттерн db.test.ts / postWriter.test.ts).
function safeRm(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'EBUSY') throw e;
  }
}

// Fake LLM без сети (паттерн postWriter.test.ts): конфиг-заглушка + перехват chat.
// Ответ различаем по user-блоку: writer просит пост, factchecker — JSON-verdict.
function fakeClient(captured: ChatMessage[][]): LlmClient {
  const client = new LlmClient({ baseUrl: 'http://127.0.0.1:1', apiKey: 'test', defaultModel: 'test' });
  client.chat = async (messages: ChatMessage[]) => {
    captured.push(messages);
    const text = messages.map((m) => m.content).join('\n');
    if (text.includes('=== НОВОСТЬ ДЛЯ ПОСТА ===')) {
      return 'Челси: Готовый пост.\n\n@lookatfacts';
    }
    if (text.includes('"verdict"')) {
      return '{"verdict":"ok","issues":[],"recommendation":"ок"}';
    }
    // Шаг 1 фактчекера — рассуждения.
    return 'Проверил имена, счёт, даты — расхождений нет.';
  };
  return client;
}

// Сетевой RSS-слой (fetchAllFeedsDetailed) в pipeline не инжектится, но есть
// существующий seam: blogs.sources. Мёртвый loopback-URL падает мгновенно
// (ECONNREFUSED, без внешней сети), ошибка собирается в rssErrors — и pipeline
// работает на предзаполненной новости из БД.
const OFFLINE_SOURCES = '["http://127.0.0.1:1/rss.xml"]';

// Свежая новость: unusedNewsSince фильтрует по published_at за последние 24 часа.
const NEWS_ROW = {
  url: 'https://example.com/chelsea-2-0',
  title: 'Челси выиграл 2:0',
  summary: 'Матч завершился победой хозяев.',
  published_at: new Date().toISOString(),
  source: 'test',
};

function writerSystemPrompt(captured: ChatMessage[][]): string {
  const writerCall = captured.find((messages) =>
    messages.some((m) => m.content.includes('=== НОВОСТЬ ДЛЯ ПОСТА ===')),
  );
  assert.ok(writerCall, 'вызов PostWriter не найден среди LLM-вызовов');
  const system = writerCall.find((m) => m.role === 'system');
  assert.ok(system, 'у вызова PostWriter нет system-сообщения');
  return system.content;
}

test('pipeline: блог с пресетом antonov — writer получает ANTONOV system-промпт (blogId не потерян)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pipeline-antonov-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    const stored = db.getBlogBySlug(DEFAULT_BLOG_SLUG)!;
    assert.equal(stored.style_preset, 'antonov');
    db.insertNews(NEWS_ROW, stored.id);

    const captured: ChatMessage[][] = [];
    const result = await runNewsPipeline(db, fakeClient(captured), {
      blog: { ...stored, sources: OFFLINE_SOURCES },
    });

    // RSS-фид недоступен (ожидалось), пост написан по новости из БД.
    assert.ok(result.rssErrors.length > 0, 'мёртвый фид должен дать rssErrors');
    assert.ok(result.post, 'пост должен быть написан');

    const system = writerSystemPrompt(captured);
    assert.ok(system.includes(ANTONOV_SYSTEM_PROMPT), 'пресет Антонова должен быть в system-промпте');
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('pipeline: default-блог — ANTONOV-маркера в writer-промпте нет', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pipeline-default-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    const stored = db.getBlogBySlug('artemia-artel')!;
    assert.equal(stored.style_preset, 'default');
    db.insertNews(NEWS_ROW, stored.id);

    const captured: ChatMessage[][] = [];
    const result = await runNewsPipeline(db, fakeClient(captured), {
      blog: { ...stored, sources: OFFLINE_SOURCES },
    });

    assert.ok(result.post, 'пост должен быть написан');

    const system = writerSystemPrompt(captured);
    assert.match(system, /Ты — автор Telegram-канала/);
    assert.ok(!system.includes(ANTONOV_SYSTEM_PROMPT), 'пресет Антонова не должен применяться');
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('pipeline: focus (тема разведки) попадает в ранжирующий промпт NewsFetcher', async () => {
  // Регрессия полного конвейера: фаза news игнорировала тему из scout.
  // 6 кандидатов > topK(5) → NewsFetcher вызывает LLM-ранжирование.
  const mkNewsDb = (): { dir: string; db: BlogDb; blog: ReturnType<BlogDb['getBlogBySlug']> } => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pipeline-focus-'));
    const db = new BlogDb(path.join(dir, 'blog.sqlite'));
    const stored = db.getBlogBySlug(DEFAULT_BLOG_SLUG)!;
    for (let i = 0; i < 6; i++) {
      db.insertNews(
        {
          url: `https://example.com/focus-${i}`,
          title: `Кандидат ${i}`,
          summary: 'Свежая новость.',
          published_at: new Date().toISOString(),
          source: 'test',
        },
        stored.id,
      );
    }
    return { dir, db, blog: { ...stored, sources: OFFLINE_SOURCES } };
  };

  // Fake как fakeClient + ветка ранжирования: валидный JSON-picks.
  const rankingClient = (captured: ChatMessage[][]): LlmClient => {
    const client = new LlmClient({ baseUrl: 'http://127.0.0.1:1', apiKey: 'test', defaultModel: 'test' });
    client.chat = async (messages: ChatMessage[]) => {
      captured.push(messages);
      const text = messages.map((m) => m.content).join('\n');
      if (text.includes('ОТВЕТ: строго JSON-массив')) {
        return '[{"i":0,"score":9,"why":"важно"}]';
      }
      if (text.includes('=== НОВОСТЬ ДЛЯ ПОСТА ===')) {
        return 'Челси: Готовый пост.\n\n@lookatfacts';
      }
      if (text.includes('"verdict"')) {
        return '{"verdict":"ok","issues":[],"recommendation":"ок"}';
      }
      return 'Проверил имена, счёт, даты — расхождений нет.';
    };
    return client;
  };

  const rankingPrompt = (captured: ChatMessage[][]): string => {
    const call = captured.find((messages) =>
      messages.some((m) => m.content.includes('ОТВЕТ: строго JSON-массив')),
    );
    assert.ok(call, 'вызов ранжирования не найден среди LLM-вызовов');
    return call.map((m) => m.content).join('\n');
  };

  const topic = 'Палмер забил хет-трик';

  const withFocus = mkNewsDb();
  try {
    const captured: ChatMessage[][] = [];
    const result = await runNewsPipeline(withFocus.db, rankingClient(captured), {
      blog: withFocus.blog,
      focus: topic,
    });
    assert.ok(result.post, 'пост должен быть написан');
    assert.ok(
      rankingPrompt(captured).includes(topic),
      'тема из focus должна направлять ранжирование',
    );
  } finally {
    withFocus.db.close();
    safeRm(withFocus.dir);
  }

  const withoutFocus = mkNewsDb();
  try {
    const captured: ChatMessage[][] = [];
    const result = await runNewsPipeline(withoutFocus.db, rankingClient(captured), {
      blog: withoutFocus.blog,
    });
    assert.ok(result.post, 'пост должен быть написан');
    const prompt = rankingPrompt(captured);
    assert.ok(!prompt.includes(topic), 'без focus тема не должна попадать в промпт');
    assert.ok(prompt.includes('Челси'), 'без focus действует дефолтный приоритет');
  } finally {
    withoutFocus.db.close();
    safeRm(withoutFocus.dir);
  }
});

test('postFromNews: пишет пост по выбранной новости и помечает её used', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pipeline-from-news-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    const stored = db.getBlogBySlug(DEFAULT_BLOG_SLUG)!;
    db.insertNews(NEWS_ROW, stored.id);
    const news = db.unusedNewsSince(new Date(Date.now() - 3600_000).toISOString(), stored.id)[0];
    assert.ok(news, 'новость должна быть в БД');

    const result = await runPostFromNews(db, fakeClient([]), {
      newsId: news.id,
      blog: stored,
    });

    assert.ok(result.postId > 0, 'postId должен быть реальным id вставленного поста');
    assert.equal(db.getPost(result.postId)?.news_id, news.id);
    assert.equal(db.getNews(news.id)?.used, 1);
    assert.equal(result.factCheck.verdict, 'ok');
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('postFromNews: чужая новость не пишется в другой блог', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pipeline-from-news-blog-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    const owner = db.getBlogBySlug(DEFAULT_BLOG_SLUG)!;
    const other = db.getBlogBySlug('nevsky-hram')!;
    db.insertNews(NEWS_ROW, owner.id);
    const news = db.unusedNewsSince(new Date(Date.now() - 3600_000).toISOString(), owner.id)[0];
    assert.ok(news);

    await assert.rejects(
      () => runPostFromNews(db, fakeClient([]), { newsId: news.id, blog: other }),
      /другому блогу/,
    );
    assert.equal(db.getNews(news.id)?.used, 0);
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('pipeline: без log — консоль молчит (issue #142, прогресс уходит только в инъекцию)', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pipeline-silent-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  const consoleCalls: string[] = [];
  t.mock.method(console, 'log', (...args: unknown[]) => {
    consoleCalls.push(args.map(String).join(' '));
  });
  try {
    const stored = db.getBlogBySlug(DEFAULT_BLOG_SLUG)!;
    db.insertNews(NEWS_ROW, stored.id);

    const result = await runNewsPipeline(db, fakeClient([]), {
      blog: { ...stored, sources: OFFLINE_SOURCES },
    });

    assert.ok(result.post, 'пост должен быть написан');
    assert.deepEqual(consoleCalls, [], 'runNewsPipeline без log не должен шуметь в console.log');
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('pipeline: инъецированный log получает прогресс-строки, console.log чист', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pipeline-log-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  const lines: string[] = [];
  const consoleCalls: string[] = [];
  t.mock.method(console, 'log', (...args: unknown[]) => {
    consoleCalls.push(args.map(String).join(' '));
  });
  try {
    const stored = db.getBlogBySlug(DEFAULT_BLOG_SLUG)!;
    db.insertNews(NEWS_ROW, stored.id);

    const result = await runNewsPipeline(db, fakeClient([]), {
      blog: { ...stored, sources: OFFLINE_SOURCES },
      log: (line) => lines.push(line),
    });

    assert.ok(result.post);
    assert.ok(lines.some((l) => l.includes('[pipeline] Агент 1:')), 'этап 1 должен логироваться');
    assert.ok(lines.some((l) => l.includes('[pipeline] Агент 2:')), 'этап 2 должен логироваться');
    assert.ok(lines.some((l) => l.includes('[pipeline] Агент 3:')), 'этап 3 должен логироваться');
    assert.deepEqual(consoleCalls, [], 'при инъекции console.log всё равно остаётся чистым');
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('pipeline: архивный блог не запускает news-пайплайн', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pipeline-archived-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    const stored = db.getBlogBySlug('nevsky-hram')!;
    await assert.rejects(
      () => runNewsPipeline(db, fakeClient([]), {
        blog: { ...stored, archived_at: '2026-11-10T00:00:00Z', sources: OFFLINE_SOURCES },
      }),
      /в архиве/,
    );
  } finally {
    db.close();
    safeRm(dir);
  }
});

test('pipeline: per-blog override автора и фактчекера доходит до агентов', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pipeline-overrides-'));
  const db = new BlogDb(path.join(dir, 'blog.sqlite'));
  try {
    const stored = db.getBlogBySlug('nevsky-hram')!;
    db.updateBlog(stored.id, { system_prompt: 'Мой авторский промпт блога' });
    db.setAgentPrompt(stored.id, 'factcheck.reasoning', 'Мой разбор для «{{channel}}»');
    db.setAgentPrompt(stored.id, 'factcheck.verdict', 'Мой вердикт для «{{channel}}»');
    db.insertNews(NEWS_ROW, stored.id);

    const captured: ChatMessage[][] = [];
    const result = await runNewsPipeline(db, fakeClient(captured), {
      blog: { ...stored, sources: OFFLINE_SOURCES },
    });
    assert.ok(result.post, 'пост должен быть написан');

    const writerSystem = writerSystemPrompt(captured);
    assert.match(writerSystem, /Мой авторский промпт блога/);

    const reasoningCall = captured.find((messages) =>
      messages.some((m) => m.content.includes('Мой разбор')),
    );
    assert.ok(reasoningCall, 'reasoning-промпт с override не найден');
    const verdictCall = captured.find((messages) =>
      messages.some((m) => m.content.includes('Мой вердикт')),
    );
    assert.ok(verdictCall, 'verdict-промпт с override не найден');
    assert.match(verdictCall[0].content, /"verdict": "ok" \| "needs_revision"/);
  } finally {
    db.close();
    safeRm(dir);
  }
});
