// Unit: automation-service — ленивый LLM-клиент (итерация 2 #78).
// Контракт: getAutomation() строится в keyless-окружении (GET /api/automation,
// /api/assistant, /api/mobile/bootstrap не должны падать 500); pickLlmClient
// резолвится только в runBlog. Границы замоканы: llm (keyless-стаб) и db.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BlogAutomation } from '../../lib/server/challenge';

// CHALLENGE_DATA_DIR до первого импорта core/paths: DATA_DIR замораживается на
// загрузке модуля, automation-service импортируется динамически в beforeAll.
const dataDir = mkdtempSync(path.join(tmpdir(), 'automation-svc-'));
process.env.CHALLENGE_DATA_DIR = dataDir;

const mocks = vi.hoisted(() => ({ pickLlmClient: vi.fn(), publishToTelegram: vi.fn() }));

vi.mock('../../lib/server/llm', () => ({ pickLlmClient: mocks.pickLlmClient }));

// Граница outbox: публикация автопостинга идёт через tg-publish-хелпер (S5).
vi.mock('../../lib/server/tg-publish', () => ({ publishToTelegram: mocks.publishToTelegram }));

// Частичный мок барреля: перехватываем фабрику, чтобы прочитать инжектированный
// publish-адаптер (канон blog-schedule-service: publish живёт в opts фабрики).
vi.mock('../../lib/server/challenge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/server/challenge')>();
  return { ...actual, createAutomationRunner: vi.fn(actual.createAutomationRunner) };
});

vi.mock('../../lib/server/db', () => ({
  getBlogDb: vi.fn(() => ({ getBlog: () => null, listBlogs: () => [] })),
}));

// Динамический импорт обязателен: static import вычислил бы core/paths до
// присваивания CHALLENGE_DATA_DIR выше (импорты поднимаются) — DATA_DIR
// заморозился бы на реальном challenge/.data.
let getAutomation: () => BlogAutomation;

beforeAll(async () => {
  ({ getAutomation } = await import('../../lib/server/automation-service'));
});

afterAll(() => {
  // WAL-дескрипторы могут пережить close() — EPERM/EBUSY не проваливают тест
  // (паттерн core-тестов); временный каталог в os.tmpdir().
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    /* каталог останется во временной директории ОС */
  }
});

describe('automation-service: публикация через outbox-хелпер (S5)', () => {
  it('publish инжектится: publishToTelegram(content, "blog", postId, "HTML", chat_id блога)', async () => {
    mocks.publishToTelegram.mockResolvedValue({ ok: true, messageId: 5 });
    getAutomation(); // singleton создан (idempotent)
    const { createAutomationRunner } = await import('../../lib/server/challenge');
    const opts = vi.mocked(createAutomationRunner).mock.calls[0]?.[0];
    expect(opts).toBeDefined();
    expect(typeof opts?.publish).toBe('function');

    // Кейс 1: chat_id блога задан → 5-й аргумент, источник 'blog', postId поста.
    const blog = { tg_chat_id: '-100777' } as Parameters<NonNullable<typeof opts.publish>>[1];
    const mapped = await opts.publish!('контент', blog, 42);
    expect(mocks.publishToTelegram).toHaveBeenCalledWith('контент', 'blog', 42, 'HTML', '-100777');
    expect(mapped).toMatchObject({ ok: true, messageId: 5 });

    // Кейс 2: chat_id блога нет → undefined (канал из env).
    const noChat = { tg_chat_id: null } as Parameters<NonNullable<typeof opts.publish>>[1];
    await opts.publish!('контент', noChat, 43);
    expect(mocks.publishToTelegram).toHaveBeenCalledWith('контент', 'blog', 43, 'HTML', undefined);
  });
});

describe('automation-service: ленивый LLM-клиент', () => {
  it('getAutomation() строится без ключей; pickLlmClient не вызывается', () => {
    const automation = getAutomation();
    expect(automation).toBeDefined();
    // Живой BlogAutomation над temp-базой: правил нет → getRule вернёт null.
    expect(automation.getRule(1)).toBeNull();
    expect(mocks.pickLlmClient).not.toHaveBeenCalled();
  });

  it('singleton: повторный вызов возвращает тот же инстанс (без второй БД)', () => {
    expect(getAutomation()).toBe(getAutomation());
  });
});
