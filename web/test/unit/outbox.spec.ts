// Unit: Outbox (web-outbox.sqlite) — реальный node:sqlite во временной папке
// (CHALLENGE_DATA_DIR переопределяет dataPath до импорта модуля).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OutboxInsert } from '../../lib/server/outbox';
type OutboxDbInstance = { insert: (row: OutboxInsert) => number; recent: (limit?: number) => OutboxRowT[]; latestForPost: (id: number) => OutboxRowT | null };
type OutboxRowT = { id: number; text: string; source: string; blog_post_id: number | null; message_id: number | null; status: 'ok' | 'error'; error: string | null; created_at: string };

let getOutboxDb: () => OutboxDbInstance;
let tmp: string;

beforeAll(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), 'outbox-test-'));
  process.env.CHALLENGE_DATA_DIR = tmp;
  ({ getOutboxDb } = await import('../../lib/server/outbox'));
});

afterAll(() => {
  delete process.env.CHALLENGE_DATA_DIR;
});

const base: OutboxInsert = { text: 'текст поста', source: 'manual', status: 'ok' };

describe('OutboxDb', () => {
  it('insert ok-записи: поля на месте (message_id, source, created_at)', () => {
    const db = getOutboxDb();
    db.insert({ ...base, messageId: 42 });
    const [row] = db.recent(1);
    expect(row.status).toBe('ok');
    expect(row.source).toBe('manual');
    expect(row.message_id).toBe(42);
    expect(row.error).toBeNull();
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('insert error-записи хранит текст ошибки', () => {
    const db = getOutboxDb();
    db.insert({ text: 'x', source: 'blog', blogPostId: 5, status: 'error', error: 'Токен бота недействителен' });
    const [row] = db.recent(1);
    expect(row.status).toBe('error');
    expect(row.blog_post_id).toBe(5);
    expect(row.error).toBe('Токен бота недействителен');
    expect(row.message_id).toBeNull();
  });

  it('recent возвращает последние по id DESC и уважает limit', () => {
    const db = getOutboxDb();
    for (let i = 0; i < 5; i++) db.insert({ ...base, text: `msg-${i}` });
    const rows = db.recent(3);
    expect(rows).toHaveLength(3);
    expect(rows[0].text).toBe('msg-4');
    expect(rows[2].text).toBe('msg-2');
  });

  it('latestForPost: последняя запись по посту (ok или error)', () => {
    const db = getOutboxDb();
    db.insert({ text: 'p', source: 'blog', blogPostId: 777, status: 'ok', messageId: 1 });
    db.insert({ text: 'p', source: 'blog', blogPostId: 777, status: 'error', error: 'retry' });
    const latest = db.latestForPost(777);
    expect(latest?.status).toBe('error');
    expect(latest?.message_id).toBeNull();
    // Чужие посты не смешиваются
    expect(db.latestForPost(12345)).toBeNull();
  });

  it('CHECK-констрейнты: невалидный source/status отклоняется', () => {
    const db = getOutboxDb();
    expect(() =>
      db.insert({ ...base, source: 'carrier-pigeon' as typeof base.source }),
    ).toThrow();
    expect(() => db.insert({ ...base, status: 'pending' as typeof base.status })).toThrow();
  });
});
