// Unit: zod-схемы форм, задействованные в TG-постинге.
import { describe, expect, it } from 'vitest';
import { tgPublishSchema, newsOptsSchema, scoutOptsSchema } from '../../lib/shared/forms';

describe('tgPublishSchema', () => {
  it('пустой текст отклоняется', () => {
    const r = tgPublishSchema.safeParse({ text: '   ' });
    expect(r.success).toBe(false);
  });

  it('4096 символов проходит, 4097 — нет (Bot API limit)', () => {
    expect(tgPublishSchema.safeParse({ text: 'a'.repeat(4096) }).success).toBe(true);
    expect(tgPublishSchema.safeParse({ text: 'a'.repeat(4097) }).success).toBe(false);
  });

  it('parseMode принимает только HTML|none; отсутствие = дефолт HTML', () => {
    expect(tgPublishSchema.safeParse({ text: 'x', parseMode: 'none' }).success).toBe(true);
    expect(tgPublishSchema.safeParse({ text: 'x', parseMode: 'MARKDOWN' }).success).toBe(false);
    const parsed = tgPublishSchema.parse({ text: 'x' });
    expect(parsed.parseMode ?? 'HTML').toBe('HTML');
  });
});

describe('newsOptsSchema / scoutOptsSchema', () => {
  it('hours ограничены 1..168', () => {
    expect(newsOptsSchema.safeParse({ hours: 0 }).success).toBe(false);
    expect(newsOptsSchema.safeParse({ hours: 169 }).success).toBe(false);
    expect(newsOptsSchema.safeParse({ hours: 48 }).success).toBe(true);
  });

  it('scout topK 1..10, llm enum', () => {
    expect(scoutOptsSchema.safeParse({ topK: 11 }).success).toBe(false);
    expect(scoutOptsSchema.safeParse({ topK: 3, llm: 'cloud' }).success).toBe(true);
    expect(scoutOptsSchema.safeParse({ llm: 'gpt5' }).success).toBe(false);
  });
});
