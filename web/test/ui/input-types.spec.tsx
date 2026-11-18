// @vitest-environment jsdom
// UI-инвентарь типов инпутов (S4 «Инпуты»): каждый затронутый контрол получает
// правильный type и доступное имя. Дешёвые mount'ы без сетевых сценариев:
// mount-fetch'ы застаблены, submit не вызывается.
// rg/chat/[dialogChatId] сознательно не монтируется (тяжёлый mount — арбитраж
// консилиума п.2); его атрибуты ловятся инвентарём остальных + e2e.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import AssistantPage from '../../app/assistant/page';
import SupportPage from '../../app/support/page';
import RagPage from '../../app/rag/page';
import TgCollectPage from '../../app/tg/collect/page';
import TgTopPage from '../../app/tg/top/page';
import BriefingPage from '../../app/briefing/page';
import RagIndexTgPage from '../../app/rag/index-tg/page';
import RagChatsPage from '../../app/rag/chats/page';
import BlogNewsPage from '../../app/blog/news/page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** Молчаливый стаб: mount-fetch'ы страниц отвечают пустыми вьюхами. */
function stubFetch(map: Record<string, unknown> = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input).split('?')[0];
      if (url in map) return json(map[url]);
      return json({});
    }),
  );
}

describe('assistant: поиск вместо безымянного текста', () => {
  it('input type=search с доступным именем «Вопрос»', () => {
    stubFetch();
    render(<AssistantPage />);

    const box = screen.getByRole('searchbox', { name: 'Вопрос' }) as HTMLInputElement;
    expect(box.type).toBe('search');
  });
});

describe('support: FAQ-поиск — type=search; плейсхолдеры тикет-формы не тронуты', () => {
  it('FAQ input type=search', () => {
    stubFetch();
    render(<SupportPage />);

    const faq = screen.getByPlaceholderText('Например: как включить автоматизацию') as HTMLInputElement;
    expect(faq.type).toBe('search');
  });

  it('регресс-пин: плейсхолдеры тикет-формы на месте (getByPlaceholderText в support-form.spec)', () => {
    stubFetch();
    render(<SupportPage />);

    expect(screen.getByPlaceholderText('Тема')).toBeTruthy();
    expect(screen.getByPlaceholderText('Опишите проблему')).toBeTruthy();
    expect(screen.getByPlaceholderText('Контакт (email/telegram, необязательно)')).toBeTruthy();
  });
});

describe('rag: вопрос — textarea с именем «вопрос по базе» (НЕ searchbox), k — number', () => {
  it('query-textarea: aria-label + TEXTAREA, не searchbox', () => {
    stubFetch();
    render(<RagPage />);

    const query = screen.getByLabelText('вопрос по базе') as HTMLTextAreaElement;
    expect(query.tagName).toBe('TEXTAREA');
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('«Чанков (k)» — type=number с границей в hint', () => {
    stubFetch();
    render(<RagPage />);

    const k = screen.getByLabelText('Чанков (k)') as HTMLInputElement;
    expect(k.type).toBe('number');
    expect(screen.getByText('1–20')).toBeTruthy();
  });
});

describe('topicId — type=number во всех tg/rag-формах (симметрия с limit/top)', () => {
  it('tg/collect', () => {
    stubFetch();
    render(<TgCollectPage />);
    expect((screen.getByLabelText('topicId') as HTMLInputElement).type).toBe('number');
  });

  it('tg/top', () => {
    stubFetch();
    render(<TgTopPage />);
    expect((screen.getByLabelText('topicId') as HTMLInputElement).type).toBe('number');
  });

  it('briefing (chatKey/topicId — Field в form)', () => {
    stubFetch({
      '/api/briefing': {
        todoSummary: 'нет задач',
        stats: {
          news: 0, posts: 0, ragFixed: 0, ragStructure: 0, ragTelegram: 0,
          tgMessages: 0, tgChats: 0, tgTopics: 0, dialogChats: 0, dialogMessages: 0,
        },
        topicId: 1,
      },
    });
    render(<BriefingPage />);

    expect((screen.getByLabelText('topicId') as HTMLInputElement).type).toBe('number');
    expect(screen.getByLabelText('chatKey')).toBeTruthy();
  });

  it('rag/index-tg', () => {
    stubFetch();
    render(<RagIndexTgPage />);
    expect((screen.getByLabelText('topicId') as HTMLInputElement).type).toBe('number');
  });

  it('rag/chats (datalist у chatKey остаётся)', () => {
    stubFetch({ '/api/rag/chats': { titles: {}, aliases: [], chats: [] } });
    render(<RagChatsPage />);

    expect((screen.getByLabelText('topicId (опц.)') as HTMLInputElement).type).toBe('number');
    const chatKey = screen.getByLabelText('chatKey') as HTMLInputElement;
    expect(chatKey.getAttribute('list')).toBe('chatkey-dl');
  });
});

describe('news: лейблы «Часов»/«Топ»/«Пост про» + type=number ×3', () => {
  it('все три поля — number с доступными именами', () => {
    stubFetch({
      '/api/blogs': {
        blogs: [
          { id: 1, slug: 'main', name: 'Главный', profile: 'default', hasProfile: true, sourcesCount: 1 },
        ],
      },
    });
    render(<BlogNewsPage />);

    const hours = screen.getByLabelText('Часов') as HTMLInputElement;
    const top = screen.getByLabelText('Топ') as HTMLInputElement;
    const forIndex = screen.getByLabelText('Пост про') as HTMLInputElement;
    expect(hours.type).toBe('number');
    expect(top.type).toBe('number');
    expect(forIndex.type).toBe('number');
  });
});
